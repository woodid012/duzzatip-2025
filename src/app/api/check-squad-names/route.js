/**
 * DuzzaTip 2026 — Check Squad Names API Route
 * GET /api/check-squad-names?token=...
 *
 * Diffs every active squad player name against the AFL API player list.
 * Reports exact matches, mismatches, and fuzzy-match suggestions so you
 * can reconcile before migrating to AFL API as source of truth.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { connectToDatabase } from "@/app/lib/mongodb";
import { CURRENT_YEAR } from "@/app/lib/constants";

const AFL_COMP_SEASON_ID = 85;

const TEAM_ABBREV = {
  "Adelaide Crows":    "ADE",
  "Brisbane Lions":    "BRL",
  "Carlton":           "CAR",
  "Collingwood":       "COL",
  "Essendon":          "ESS",
  "Fremantle":         "FRE",
  "Geelong Cats":      "GEE",
  "Gold Coast SUNS":   "GCS",
  "GWS GIANTS":        "GWS",
  "Hawthorn":          "HAW",
  "Melbourne":         "MEL",
  "North Melbourne":   "NTH",
  "Port Adelaide":     "PTA",
  "Richmond":          "RIC",
  "St Kilda":          "STK",
  "Sydney Swans":      "SYD",
  "West Coast Eagles": "WCE",
  "Western Bulldogs":  "WBD",
};

async function getAFLToken() {
  const res = await fetch("https://api.afl.com.au/cfs/afl/WMCTok", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "https://www.afl.com.au" },
    body: "{}",
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  return data.token;
}

// Normalise for fuzzy comparison: lowercase, strip punctuation, collapse spaces
function norm(name) {
  return (name || "")
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Simple edit-distance (Levenshtein) for fuzzy suggestions
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

// Auth
function checkAuth(request) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  const { searchParams } = new URL(request.url);
  if (searchParams.get("token") === secret) return true;
  return false;
}

export async function GET(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Fetch AFL API player list
    const token = await getAFLToken();
    const headers = { "x-media-mis-token": token };

    const teamsRes = await fetch(
      "https://aflapi.afl.com.au/afl/v2/teams?pageSize=50",
      { headers, signal: AbortSignal.timeout(10000) }
    );
    const teamsData = await teamsRes.json();
    const menTeams = (teamsData.teams || []).filter(t => t.teamType === "MEN");

    const aflPlayers = []; // { name, normName, team }
    const teamResults = await Promise.allSettled(
      menTeams.map(async (team) => {
        const squadRes = await fetch(
          `https://aflapi.afl.com.au/afl/v2/squads?teamId=${team.id}&compSeasonId=${AFL_COMP_SEASON_ID}&pageSize=1000`,
          { headers, signal: AbortSignal.timeout(10000) }
        );
        const data = await squadRes.json();
        const abbrev = TEAM_ABBREV[team.name] || team.abbreviation;
        return (data.squad?.players || []).map(p => ({
          name: `${p.player.firstName} ${p.player.surname}`.trim(),
          team: abbrev,
        }));
      })
    );
    for (const r of teamResults) {
      if (r.status === "fulfilled") aflPlayers.push(...r.value);
    }

    // Build lookup maps
    const aflByExact = new Map(aflPlayers.map(p => [p.name, p]));
    const aflByNorm  = new Map(aflPlayers.map(p => [norm(p.name), p]));

    // 2. Load active squad players from MongoDB
    const { db } = await connectToDatabase();
    const squadDocs = await db
      .collection(`${CURRENT_YEAR}_squads`)
      .find({ Active: 1 })
      .toArray();

    // 3. Diff
    const exact    = [];
    const normOnly = []; // name differs in case/punctuation but normalises to same
    const mismatch = []; // no match found — include fuzzy suggestions

    for (const sq of squadDocs) {
      const sqName = sq.player_name;
      const sqNorm = norm(sqName);

      if (aflByExact.has(sqName)) {
        const afl = aflByExact.get(sqName);
        const teamMatch = afl.team === sq.team;
        exact.push({
          squad_name: sqName,
          squad_team: sq.team,
          afl_team: afl.team,
          team_match: teamMatch,
          user_id: sq.user_id,
        });
        continue;
      }

      if (aflByNorm.has(sqNorm)) {
        const afl = aflByNorm.get(sqNorm);
        normOnly.push({
          squad_name: sqName,
          afl_name: afl.name,         // the correct AFL API spelling
          squad_team: sq.team,
          afl_team: afl.team,
          user_id: sq.user_id,
        });
        continue;
      }

      // No match — find closest AFL player names (same team preferred, top 3)
      const sameTeam = aflPlayers.filter(p => p.team === sq.team);
      const pool = sameTeam.length > 0 ? sameTeam : aflPlayers;
      const suggestions = pool
        .map(p => ({ name: p.name, team: p.team, dist: editDistance(sqNorm, norm(p.name)) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3);

      mismatch.push({
        squad_name: sqName,
        squad_team: sq.team,
        user_id: sq.user_id,
        suggestions,
      });
    }

    // 4. Also flag AFL API players on the same team as a squad player but with no squad match
    //    (useful for spotting trades — player left your team)
    const allSquadNames = new Set(squadDocs.map(s => s.player_name));
    const allSquadNorms = new Set(squadDocs.map(s => norm(s.player_name)));

    return Response.json({
      summary: {
        afl_api_total: aflPlayers.length,
        squad_total: squadDocs.length,
        exact_match: exact.length,
        norm_match_rename_needed: normOnly.length,
        no_match: mismatch.length,
      },
      // Only exact matches with team mismatch (traded players)
      team_mismatches: exact.filter(e => !e.team_match).map(e => ({
        name: e.squad_name,
        squad_team: e.squad_team,
        afl_team: e.afl_team,
        user_id: e.user_id,
      })),
      // Need a rename in MongoDB to match AFL API
      rename_needed: normOnly.map(e => ({
        squad_name: e.squad_name,
        correct_afl_name: e.afl_name,
        squad_team: e.squad_team,
        afl_team: e.afl_team,
        user_id: e.user_id,
      })),
      // No AFL API match at all — needs manual resolution
      no_match: mismatch,
    });

  } catch (e) {
    console.error("check-squad-names error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

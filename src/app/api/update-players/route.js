/**
 * DuzzaTip 2026 — Update Players API Route
 * GET /api/update-players?token=...
 *
 * Fetches all AFL player rosters from the official AFL API and upserts
 * to MongoDB `2026_players` collection. Also syncs team names in squads.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { connectToDatabase } from "@/app/lib/mongodb";
import { CURRENT_YEAR } from "@/app/lib/constants";

const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership

// AFL API team abbreviations used in our DB
const TEAM_ABBREV = {
  "Adelaide Crows":     "ADE",
  "Brisbane Lions":     "BRL",
  "Carlton":            "CAR",
  "Collingwood":        "COL",
  "Essendon":           "ESS",
  "Fremantle":          "FRE",
  "Geelong Cats":       "GEE",
  "Gold Coast SUNS":    "GCS",
  "GWS GIANTS":        "GWS",
  "Hawthorn":           "HAW",
  "Melbourne":          "MEL",
  "North Melbourne":    "NTH",
  "Port Adelaide":      "PTA",
  "Richmond":           "RIC",
  "St Kilda":           "STK",
  "Sydney Swans":       "SYD",
  "West Coast Eagles":  "WCE",
  "Western Bulldogs":   "WBD",
};

// ── AFL API auth ──────────────────────────────────────────────────────────────
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

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const token = await getAFLToken();
    const headers = { "x-media-mis-token": token };

    // 1. Get all teams
    const teamsRes = await fetch(
      "https://aflapi.afl.com.au/afl/v2/teams?pageSize=50",
      { headers, signal: AbortSignal.timeout(10000) }
    );
    const teamsData = await teamsRes.json();
    const menTeams = (teamsData.teams || []).filter(t => t.teamType === "MEN");

    if (menTeams.length === 0) {
      return Response.json({ error: "No teams found from AFL API" }, { status: 502 });
    }

    // 2. Fetch squads for each team in parallel
    const allPlayers = [];
    const teamResults = await Promise.allSettled(
      menTeams.map(async (team) => {
        const squadRes = await fetch(
          `https://aflapi.afl.com.au/afl/v2/squads?teamId=${team.id}&compSeasonId=${AFL_COMP_SEASON_ID}&pageSize=1000`,
          { headers, signal: AbortSignal.timeout(10000) }
        );
        const data = await squadRes.json();
        const players = data.squad?.players || [];
        const abbrev = TEAM_ABBREV[team.name] || team.abbreviation;

        return players.map(p => ({
          player_name: `${p.player.firstName} ${p.player.surname}`,
          team_name: abbrev,
          team_full: team.name,
          afl_id: p.player.id,
          provider_id: p.player.providerId,
          position: p.position || "",
          jumper: p.jumperNumber || 0,
        }));
      })
    );

    for (const result of teamResults) {
      if (result.status === "fulfilled") {
        allPlayers.push(...result.value);
      }
    }

    if (allPlayers.length === 0) {
      return Response.json({ error: "No players fetched from AFL API" }, { status: 502 });
    }

    // 3. Upsert to MongoDB
    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_players`);

    // Clear and re-insert (same pattern as the Python notebook)
    await collection.deleteMany({});
    const insertResult = await collection.insertMany(
      allPlayers.map(p => ({
        player_id: p.provider_id || `afl-${p.afl_id}`,
        player_name: p.player_name,
        team_name: p.team_name,
      }))
    );

    // 4. Sync team names in squads collection
    // For each active squad player, update their team to match the current AFL roster
    // Squads use abbreviations (ADE, SYD etc) so map player → abbreviation
    const playerTeamMap = {};
    for (const p of allPlayers) {
      playerTeamMap[p.player_name] = p.team_name; // abbreviation
    }

    const squadsCollection = db.collection(`${CURRENT_YEAR}_squads`);
    const activeSquadPlayers = await squadsCollection.find({ Active: 1 }).toArray();
    const teamUpdates = [];

    for (const sq of activeSquadPlayers) {
      const currentTeam = playerTeamMap[sq.player_name];
      if (currentTeam && currentTeam !== sq.team) {
        teamUpdates.push({
          player: sq.player_name,
          from: sq.team,
          to: currentTeam,
        });
        await squadsCollection.updateMany(
          { player_name: sq.player_name, Active: 1 },
          { $set: { team: currentTeam } }
        );
      }
    }

    return Response.json({
      ok: true,
      teams: menTeams.length,
      players: allPlayers.length,
      inserted: insertResult.insertedCount,
      teamUpdatesInSquads: teamUpdates,
      sample: allPlayers.slice(0, 5).map(p => ({ name: p.player_name, team: p.team_name })),
    });
  } catch (e) {
    console.error("update-players error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

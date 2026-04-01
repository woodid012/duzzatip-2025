/**
 * DuzzaTip 2026 — Lockout Notify API Route
 * POST /api/lockout-notify
 *
 * Called by openclaw (on Hostinger) when AFL team selections are detected.
 * Computes optimal team + tips, saves to MongoDB, sends Telegram message.
 *
 * Auth: Authorization: Bearer <NOTIFY_SECRET>
 *   or: ?token=<NOTIFY_SECRET>
 *
 * Query params:
 *   ?force=1    — skip the 24h lockout gate
 *   ?dry=1      — compute only, no DB saves or Telegram send
 *   ?round=N    — force a specific round
 *   ?probe=1    — just check if teams are announced (no compute, no send)
 */

// This endpoint is time-sensitive; disable caching.
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { connectToDatabase } from "@/app/lib/mongodb";
import { INJURIES } from "@/app/lib/injuries_2026";
import fs from "fs";
import path from "path";

const MY_USER = 4;
const YEAR    = 2026;
const NOTIFY_WINDOW_HOURS = 24;
const FINAL_WINDOW_MINS   = 45;
const TELEGRAM_CHAT_ID    = "8600335192";

// ── Scoring ──────────────────────────────────────────────────────────────────
const SCORE_FNS = {
  "Full Forward": (s) => s.goals * 9 + s.behinds,
  "Midfielder":   (s) => { const d = s.kicks + s.handballs; return Math.min(d, 30) + Math.max(0, d - 30) * 3; },
  "Offensive":    (s) => s.goals * 7 + s.kicks,
  "Tall Forward": (s) => s.goals * 6 + s.marks * 2,
  "Tackler":      (s) => s.tackles * 4 + s.handballs,
  "Ruck":         (s) => {
    const t = s.hitouts + s.marks;
    if (t <= 18) return t;
    const reg = Math.max(0, 18 - s.hitouts);
    return s.hitouts + reg + (s.marks - reg) * 3;
  },
};
const MAIN_POSITIONS   = ["Full Forward", "Tall Forward", "Offensive", "Midfielder", "Tackler", "Ruck"];
const POS_SHORT        = { "Full Forward": "FF", "Tall Forward": "TF", "Offensive": "OFF", "Midfielder": "MID", "Tackler": "TAK", "Ruck": "RUC" };
const RESERVE_A_COVERS = ["Full Forward", "Tall Forward", "Ruck"];
const RESERVE_B_COVERS = ["Offensive", "Midfielder", "Tackler"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function dn(name) {
  if (!name) return name;
  const parts = name.trim().split(" ");
  return parts.length < 2 ? name : `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
}
function normName(n) {
  return (n || "").toLowerCase().replace(/'/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}
// ── Injuries (MongoDB-first, static fallback) ────────────────────────────────
async function loadInjuries(db) {
  try {
    const doc = await db.collection("injuries").findOne({ _id: `injuries_${YEAR}` });
    if (doc?.players && Object.keys(doc.players).length > 0) {
      console.log(`[injuries] Loaded ${Object.keys(doc.players).length} from MongoDB (updated ${doc.updated?.toISOString()})`);
      return doc.players;
    }
  } catch (_) {}
  console.log(`[injuries] Falling back to static INJURIES (${Object.keys(INJURIES).length} players)`);
  return INJURIES;
}

// Lookup injury by player name — keys are now "Name (Team)"
function findInjury(name, injuries) {
  if (!name) return null;
  const match = Object.keys(injuries).find(k => k.startsWith(name + " ("));
  return match ? injuries[match] : (injuries[name] || null);
}
function injSeverity(name, injuries) {
  const inj = findInjury(name, injuries);
  if (!inj) return 0;
  return { SEASON: 4, MONTHS: 3, WEEKS: 2, DOUBT: 1, MANAGED: 0 }[inj.status] ?? 0;
}
function injNote(name, injuries) {
  const inj = findInjury(name, injuries);
  if (!inj) return "";
  const labels = { SEASON: "OUT SEASON", MONTHS: "OUT MONTHS", WEEKS: "OUT WEEKS", DOUBT: "DOUBT", MANAGED: "managed" };
  return ` [${labels[inj.status]}: ${inj.detail}]`;
}
function formatGameTime(dateUtc) {
  return new Date(dateUtc).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
function loadFixtures() {
  const p = path.join(process.cwd(), "public", `afl-${YEAR}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function getCurrentRound(fixtures) {
  const now = new Date();
  const upcoming = fixtures.filter(f => f.RoundNumber >= 0 && new Date(f.DateUtc) > now);
  if (!upcoming.length) return Math.max(...fixtures.map(f => f.RoundNumber));
  return upcoming[0].RoundNumber;
}
function getLockoutInfo(fixtures, round) {
  const rf = fixtures.filter(f => f.RoundNumber === round).sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));
  if (!rf.length) return null;
  const firstGame = new Date(rf[0].DateUtc);
  const now = new Date();
  const minsUntil  = Math.round((firstGame - now) / 60000);
  const hoursUntil = minsUntil / 60;
  const melbTime   = firstGame.toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", day: "numeric",
    month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  });
  return { firstGame, locked: now >= firstGame, minsUntil, hoursUntil, melbTime };
}
function getRoundFixtures(fixtures, round) {
  return fixtures.filter(f => f.RoundNumber === round).sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));
}

// ── Team aliases & bye detection ──────────────────────────────────────────────
const TEAM_ALIASES = {
  "adelaide-crows":    ["ADE", "Adelaide", "Adelaide Crows"],
  "brisbane-lions":    ["BRL", "BL", "Brisbane", "Brisbane Lions"],
  "carlton":           ["CAR", "Carlton", "Carlton Blues"],
  "collingwood":       ["COL", "Collingwood", "Collingwood Magpies"],
  "essendon":          ["ESS", "Essendon", "Essendon Bombers"],
  "fremantle":         ["FRE", "Fremantle", "Fremantle Dockers"],
  "geelong-cats":      ["GEE", "Geelong", "Geelong Cats"],
  "gold-coast-suns":   ["GCS", "GC", "Gold Coast", "Gold Coast SUNS", "Gold Coast Suns"],
  "gws-giants":        ["GWS", "GWS Giants", "GWS GIANTS", "Greater Western Sydney"],
  "hawthorn":          ["HAW", "Hawthorn", "Hawthorn Hawks"],
  "melbourne":         ["MEL", "Melbourne", "Melbourne Demons"],
  "north-melbourne":   ["NTH", "North", "North Melbourne", "North Melbourne Kangaroos"],
  "port-adelaide":     ["PTA", "Port", "Port Adelaide", "Port Adelaide Power"],
  "richmond":          ["RIC", "Richmond", "Richmond Tigers"],
  "st-kilda":          ["STK", "St Kilda", "St Kilda Saints"],
  "sydney-swans":      ["SYD", "Sydney", "Sydney Swans"],
  "west-coast-eagles": ["WCE", "West Coast", "West Coast Eagles"],
  "western-bulldogs":  ["WBD", "WB", "Western Bulldogs"],
};
function findTeamSlug(dbTeam) {
  const dbT = (dbTeam || "").toLowerCase().trim();
  for (const [slug, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === dbT)) return slug;
  }
  for (const [slug, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(a => dbT.includes(a.toLowerCase()) || a.toLowerCase().includes(dbT))) return slug;
    if (slug.replace(/-/g, " ").includes(dbT) || dbT.includes(slug.replace(/-/g, " "))) return slug;
  }
  return null;
}
function getPlayingTeams(roundFixtures) {
  const teams = new Set();
  for (const f of roundFixtures) { teams.add(f.HomeTeam); teams.add(f.AwayTeam); }
  return teams;
}
function teamIsPlaying(dbTeam, playingTeams) {
  if (!dbTeam) return true;
  const dbT = dbTeam.toLowerCase().trim();
  for (const t of playingTeams) {
    if (t.toLowerCase().includes(dbT) || dbT.includes(t.toLowerCase().split(" ")[0])) return true;
  }
  const slug = findTeamSlug(dbTeam);
  if (slug) {
    const aliases = TEAM_ALIASES[slug] || [];
    for (const t of playingTeams) {
      if (aliases.some(a => t.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(t.toLowerCase().split(" ")[0]))) return true;
    }
  }
  return false;
}

// ── Player stats ──────────────────────────────────────────────────────────────
function calcAvgStats(games) {
  const keys = ["kicks", "handballs", "marks", "tackles", "hitouts", "goals", "behinds"];
  const avg = {};
  for (const k of keys) avg[k] = games.reduce((a, g) => a + (Number(g[k]) || 0), 0) / games.length;
  return avg;
}
function scoreAllPositions(avg) {
  if (!avg) return {};
  const out = {};
  for (const [pos, fn] of Object.entries(SCORE_FNS)) out[pos] = Math.round(fn(avg) * 10) / 10;
  return out;
}
async function loadPlayerStats(db, names) {
  const stats = {};

  // 1. Try current-year in-season data (exclude round 0 preseason, deduplicate)
  try {
    const docs = await db.collection(`${YEAR}_game_results`).find({
      player_name: { $in: names },
      round: { $gte: 1 },
    }).toArray();
    const byPlayer = {};
    for (const d of docs) {
      if (!byPlayer[d.player_name]) byPlayer[d.player_name] = [];
      if (byPlayer[d.player_name].some(g => g.round === d.round)) continue; // deduplicate
      byPlayer[d.player_name].push(d);
    }
    for (const [name, games] of Object.entries(byPlayer)) {
      if (games.length >= 2) stats[name] = { source: `${YEAR}(${games.length}g)`, avg: calcAvgStats(games), games };
    }
  } catch (_) {}

  // 2. Fall back to 2025 data for players with no current-year stats (pre-season or new players)
  const need2025 = names.filter(n => !stats[n]);
  if (need2025.length > 0) {
    try {
      const docs2025 = await db.collection("2025_game_results")
        .find({ player_name: { $in: need2025 } }, { projection: { player_name: 1, kicks: 1, handballs: 1, marks: 1, tackles: 1, hitouts: 1, goals: 1, behinds: 1, _id: 0 } })
        .toArray();
      const byPlayer = {};
      for (const d of docs2025) {
        if (!byPlayer[d.player_name]) byPlayer[d.player_name] = [];
        byPlayer[d.player_name].push(d);
      }
      for (const [name, games] of Object.entries(byPlayer)) {
        if (games.length >= 3) stats[name] = { source: `2025(${games.length}g)`, avg: calcAvgStats(games), games };
      }
    } catch (_) {}
  }

  return stats;
}

// ── 2025 position scores via stats-report ─────────────────────────────────────
// Maps stats-report short keys → lockout-notify full position names
const SHORT_TO_FULL = {
  FF:  "Full Forward",
  TF:  "Tall Forward",
  OFF: "Offensive",
  MID: "Midfielder",
  TAK: "Tackler",
  RUC: "Ruck",
};

// Fetches squad 2025 position scores from the stats-report endpoint.
// Returns a map keyed by lowercase player name → { scores: {<full pos>: pts}, games }.
async function fetchSquad2025Scores() {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret) return {};
  try {
    const url = `https://duzzatip.vercel.app/api/stats-report?token=${encodeURIComponent(secret)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const byName = {};
    for (const p of (data.squadPlayers || [])) {
      const key = (p.name || "").toLowerCase().trim();
      const scores = {};
      for (const [short, full] of Object.entries(SHORT_TO_FULL)) {
        if (p.scores?.[short] != null) scores[full] = p.scores[short];
      }
      byName[key] = { scores, games: p.games ?? 0 };
    }
    return byName;
  } catch (_) {
    return {};
  }
}

// ── Optimal lineup ─────────────────────────────────────────────────────────────
function findOptimalLineup(squadPlayers, excluded = new Set()) {
  // If we have no scores (common early season), fall back to squad order so we still fill all 9 slots.
  const eligible = squadPlayers.filter(p => !excluded.has(p.name));
  const scoredPool = eligible.filter(p => Object.keys(p.scores).length > 0);
  const useFallback = scoredPool.length === 0;

  const pool = useFallback
    ? eligible
    : scoredPool;

  const assigned = {}, used = new Set(), remaining = [...MAIN_POSITIONS];

  while (remaining.length > 0) {
    let bestPos = null, bestPlayer = null, bestMargin = -Infinity;

    if (useFallback) {
      // Just fill in order across positions.
      bestPos = remaining[0];
      bestPlayer = pool.find(p => !used.has(p.name)) || null;
      if (!bestPlayer) break;
    } else {
      for (const pos of remaining) {
        const candidates = pool
          .filter(p => !used.has(p.name))
          .sort((a, b) => (b.scores[pos] || 0) - (a.scores[pos] || 0));
        if (!candidates.length) continue;
        const margin = (candidates[0].scores[pos] || 0) - (candidates[1]?.scores[pos] || 0);
        if (margin > bestMargin) { bestMargin = margin; bestPos = pos; bestPlayer = candidates[0]; }
      }
      if (!bestPos) break;
    }

    assigned[bestPos] = bestPlayer; used.add(bestPlayer.name);
    remaining.splice(remaining.indexOf(bestPos), 1);
  }
  for (const pos of MAIN_POSITIONS) {
    if (!assigned[pos]) {
      const best = useFallback
        ? pool.find(p => !used.has(p.name))
        : pool.filter(p => !used.has(p.name)).sort((a, b) => (b.scores[pos] || 0) - (a.scores[pos] || 0))[0];
      if (best) { assigned[pos] = best; used.add(best.name); }
    }
  }

  const bench = useFallback
    ? (pool.find(p => !used.has(p.name)) || null)
    : (pool.filter(p => !used.has(p.name))
        .sort((a, b) => Math.max(...Object.values(b.scores)) - Math.max(...Object.values(a.scores)))[0] || null);
  if (bench) used.add(bench.name);

  let benchBackup = MAIN_POSITIONS[0];
  if (bench?.scores) {
    let best = -1;
    for (const pos of MAIN_POSITIONS) {
      if ((bench.scores[pos] || 0) > best) { best = bench.scores[pos]; benchBackup = pos; }
    }
  }

  const resAScore = p => Math.max(...RESERVE_A_COVERS.map(pos => p.scores[pos] || 0));
  const resA = useFallback
    ? (pool.find(p => !used.has(p.name)) || null)
    : (pool.filter(p => !used.has(p.name)).sort((a, b) => resAScore(b) - resAScore(a))[0] || null);
  if (resA) used.add(resA.name);

  const resBScore = p => Math.max(...RESERVE_B_COVERS.map(pos => p.scores[pos] || 0));
  const resB = useFallback
    ? (pool.find(p => !used.has(p.name)) || null)
    : (pool.filter(p => !used.has(p.name)).sort((a, b) => resBScore(b) - resBScore(a))[0] || null);

  return { lineup: assigned, bench, benchBackup, reserveA: resA, reserveB: resB };
}

// ── Bench backup optimisation (variance-based) ────────────────────────────────
// Score a single game at a given position using the position's scoring formula.
function scoreGame(game, pos) {
  const s = {
    kicks:     Number(game.kicks)     || 0,
    handballs: Number(game.handballs) || 0,
    marks:     Number(game.marks)     || 0,
    tackles:   Number(game.tackles)   || 0,
    hitouts:   Number(game.hitouts)   || 0,
    goals:     Number(game.goals)     || 0,
    behinds:   Number(game.behinds)   || 0,
  };
  return SCORE_FNS[pos](s);
}

// E[max(bench, main) − main] over all game-pair combinations for a given position.
// This is the "option value" of the bench backing up that position.
function expectedBenchGain(benchGames, mainGames, pos) {
  if (!benchGames?.length || !mainGames?.length) return 0;
  let totalGain = 0, count = 0;
  for (const bg of benchGames) {
    const bs = scoreGame(bg, pos);
    for (const mg of mainGames) {
      totalGain += Math.max(bs - scoreGame(mg, pos), 0);
      count++;
    }
  }
  return count > 0 ? Math.round((totalGain / count) * 10) / 10 : 0;
}

// Returns { pos, gain } — the backup position that maximises expected bench gain.
// Falls back to the bench player's own best position if no game data is available.
function findBestBenchBackup(lineup, bench, statsMap) {
  if (!bench) return { pos: MAIN_POSITIONS[0], gain: 0 };
  const benchGames = statsMap[bench.name]?.games || [];
  if (!benchGames.length) {
    // No game data — fall back to bench player's best scoring position
    return { pos: bench.bestPos || MAIN_POSITIONS[0], gain: 0 };
  }
  let bestPos = null, bestGain = -Infinity;
  for (const pos of MAIN_POSITIONS) {
    const mainPlayer = lineup[pos];
    if (!mainPlayer) continue;
    const mainGames = statsMap[mainPlayer.name]?.games || [];
    const gain = expectedBenchGain(benchGames, mainGames, pos);
    if (gain > bestGain) { bestGain = gain; bestPos = pos; }
  }
  return { pos: bestPos || bench.bestPos || MAIN_POSITIONS[0], gain: bestGain };
}

// ── AFL team selections (AFL.com.au API) ──────────────────────────────────────
const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership

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

function aflTeamNameToSlug(aflName) {
  const n = (aflName || "").toLowerCase().trim();
  for (const [slug, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === n)) return slug;
    if (slug.replace(/-/g, " ").includes(n) || n.includes(slug.replace(/-/g, " "))) return slug;
  }
  return null;
}

async function fetchAFLTeamSelections(roundNumber) {
  try {
    const token = await getAFLToken();
    const headers = { "x-media-mis-token": token };

    // Fetch matches for the round
    const matchesRes = await fetch(
      `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${roundNumber}&pageSize=20`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    const matchesData = await matchesRes.json();
    const matches = matchesData.matches || [];

    const result = {};
    let ppCount = 0;
    let teamsFound = 0;

    // Fetch roster for each match
    // Try /full endpoint first (standard), fall back to non-full (Opening Round uses this)
    await Promise.all(matches.map(async (match) => {
      const providerId = match.providerId;
      if (!providerId) return;
      try {
        let roster = null;
        let usedFull = false;

        // Try /full first
        const fullRes = await fetch(
          `https://api.afl.com.au/cfs/afl/matchRoster/full/${providerId}`,
          { headers, signal: AbortSignal.timeout(10000) }
        );
        if (fullRes.ok) {
          const fullData = await fullRes.json();
          const hasPositions = (fullData.homeTeam?.positions?.length || 0) + (fullData.awayTeam?.positions?.length || 0) > 0;
          if (hasPositions) { roster = fullData; usedFull = true; }
        }

        // Fall back to non-full endpoint (e.g. Opening Round)
        if (!roster) {
          const baseRes = await fetch(
            `https://api.afl.com.au/cfs/afl/matchRoster/${providerId}`,
            { headers, signal: AbortSignal.timeout(10000) }
          );
          if (baseRes.ok) roster = await baseRes.json();
        }

        if (!roster) return;

        for (const side of ["homeTeam", "awayTeam"]) {
          const teamData = roster[side];
          if (!teamData) continue;
          const teamName = teamData.teamName?.teamName || match[side.replace("Team", "")]?.team?.name || "";
          const slug = aflTeamNameToSlug(teamName);
          if (!slug) continue;

          const named22 = [];
          const emergencies = [];
          for (const player of (teamData.positions || [])) {
            // /full uses player.givenName, non-full uses player.player.playerName.givenName
            const givenName = usedFull
              ? (player.givenName || "")
              : (player.player?.playerName?.givenName || "");
            const surname = usedFull
              ? (player.surname || "")
              : (player.player?.playerName?.surname || "");
            const name = `${givenName} ${surname}`.trim();
            if (!name) continue;
            if (player.position === "EMERG") emergencies.push(name);
            else named22.push(name);
          }
          if (named22.length > 0 || emergencies.length > 0) {
            result[slug] = { named22, emergencies };
            ppCount += named22.length + emergencies.length;
            teamsFound++;
          }
        }
      } catch (_) {} // individual roster fetch failure — skip
    }));

    return { selections: teamsFound > 0 ? result : null, teamsFound, ppCount };
  } catch (e) {
    return { selections: null, teamsFound: 0, ppCount: 0, error: e.message };
  }
}
function buildSelectionStatus(squadPlayers, fwSelections) {
  const status = new Map();
  for (const p of squadPlayers) {
    const slug = findTeamSlug(p.team);
    if (!slug || !fwSelections[slug]) { status.set(p.name, "unknown"); continue; }
    const { named22, emergencies } = fwSelections[slug];
    const norm = normName(p.name);
    if (named22.some(fw => normName(fw) === norm)) status.set(p.name, "playing");
    else if (emergencies.some(fw => normName(fw) === norm)) status.set(p.name, "emergency");
    else status.set(p.name, "out");
  }
  return status;
}

// ── Tips ──────────────────────────────────────────────────────────────────────
async function fetchSquiggleTips(round) {
  try {
    const res = await fetch(`https://api.squiggle.com.au/?q=tips;year=${YEAR};round=${round}`, {
      headers: { "User-Agent": "DuzzaTip-Notify/1.0 (afl fantasy assistant)" },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return data?.tips?.length ? data.tips : null;
  } catch (_) { return null; }
}

async function fetchSportsbetOdds() {
  try {
    const { load } = await import("cheerio");
    const res = await fetch("https://www.sportsbet.com.au/betting/australian-rules", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = load(html);
    const odds = {};

    // Try data-automation-id patterns
    $("[data-automation-id]").each((_, el) => {
      const id = $(el).attr("data-automation-id") || "";
      if (id.includes("price") || id.includes("participant")) {
        const text = $(el).text().trim();
        const price = parseFloat(text);
        if (!isNaN(price) && price > 1) {
          const name = $(el).closest("[data-automation-id*='event']").find("[data-automation-id*='name']").first().text().trim();
          if (name) odds[name] = price;
        }
      }
    });

    // Fallback: JSON embedded in script tags
    if (Object.keys(odds).length === 0) {
      $("script").each((_, el) => {
        const txt = $(el).html() || "";
        const match = txt.match(/"name"\s*:\s*"([^"]+)"[^}]+"win"\s*:\s*(\d+\.?\d*)/g);
        if (match) {
          match.forEach(m => {
            const nm = m.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
            const price = parseFloat(m.match(/"win"\s*:\s*(\d+\.?\d*)/)?.[1]);
            if (nm && !isNaN(price) && price > 1) odds[nm] = price;
          });
        }
      });
    }

    return Object.keys(odds).length > 0 ? odds : null;
  } catch (_) { return null; }
}

function buildTipSuggestions(roundFixtures, squiggleTips, sportsbetOdds) {
  const tips = roundFixtures.map(f => {
    let homePct = 50, source = "default";
    let homeOdds = null, awayOdds = null;

    // Squiggle (win probability 0-100 for home team per tipster)
    if (squiggleTips) {
      const candidates = squiggleTips.filter(t =>
        (t.hteam?.toLowerCase().includes(f.HomeTeam.split(" ")[0].toLowerCase()) ||
         f.HomeTeam.toLowerCase().includes((t.hteam || "").split(" ")[0].toLowerCase())) &&
        (t.ateam?.toLowerCase().includes(f.AwayTeam.split(" ")[0].toLowerCase()) ||
         f.AwayTeam.toLowerCase().includes((t.ateam || "").split(" ")[0].toLowerCase()))
      );
      if (candidates.length > 0) {
        homePct = candidates.reduce((a, t) => {
          const explicitHomePct = parseFloat(t.hconfidence);
          if (!Number.isNaN(explicitHomePct)) return a + explicitHomePct;

          const tippedPct = parseFloat(t.confidence);
          if (Number.isNaN(tippedPct)) return a + 50;
          return a + (t.tip === f.HomeTeam ? tippedPct : 100 - tippedPct);
        }, 0) / candidates.length;
        source = `Squiggle(${candidates.length})`;
      }
    }

    // Sportsbet (decimal odds → implied probability)
    if (sportsbetOdds) {
      const homeKey = Object.keys(sportsbetOdds).find(k =>
        f.HomeTeam.toLowerCase().includes(k.toLowerCase().split(" ")[0]) ||
        k.toLowerCase().includes(f.HomeTeam.toLowerCase().split(" ")[0])
      );
      const awayKey = Object.keys(sportsbetOdds).find(k =>
        f.AwayTeam.toLowerCase().includes(k.toLowerCase().split(" ")[0]) ||
        k.toLowerCase().includes(f.AwayTeam.toLowerCase().split(" ")[0])
      );
      if (homeKey && awayKey) {
        homeOdds = sportsbetOdds[homeKey];
        awayOdds = sportsbetOdds[awayKey];
        // Override with implied probability from market odds
        const hProb = 1 / homeOdds;
        const aProb = 1 / awayOdds;
        homePct = Math.round((hProb / (hProb + aProb)) * 100);
        source = `Sportsbet`;
      }
    }

    const favourite = homePct >= 50 ? f.HomeTeam : f.AwayTeam;
    const confidence = Math.round(Math.max(homePct, 100 - homePct));
    const favOdds = favourite === f.HomeTeam ? homeOdds : awayOdds;

    return {
      matchNumber: f.MatchNumber, homeTeam: f.HomeTeam, awayTeam: f.AwayTeam,
      dateUtc: f.DateUtc, favourite, confidence, homeOdds, awayOdds, favOdds, source,
    };
  });
  for (const t of tips) {
    if (t.confidence >= 75) t.suggestDC = true;
  }
  return tips;
}

// ── DB saves ──────────────────────────────────────────────────────────────────
async function saveTeamSelection(db, round, result) {
  const col = db.collection(`${YEAR}_team_selection`);
  const bulkOps = [{ updateMany: { filter: { Round: round, User: MY_USER }, update: { $set: { Active: 0 } } } }];
  const toSave = [
    ...MAIN_POSITIONS.map(pos => result.lineup[pos] ? { pos, name: result.lineup[pos].name } : null),
    result.bench    ? { pos: "Bench",     name: result.bench.name,    backup: result.benchBackup } : null,
    result.reserveA ? { pos: "Reserve A", name: result.reserveA.name } : null,
    result.reserveB ? { pos: "Reserve B", name: result.reserveB.name } : null,
  ].filter(Boolean);
  for (const { pos, name, backup } of toSave) {
    bulkOps.push({ updateOne: {
      filter: { Round: round, User: MY_USER, Position: pos },
      update: { $set: { Player_Name: name, Position: pos, Round: round, User: MY_USER,
        ...(pos === "Bench" && backup ? { Backup_Position: backup } : {}),
        Active: 1, Last_Updated: new Date() } },
      upsert: true,
    }});
  }
  await col.bulkWrite(bulkOps, { ordered: false });
}
async function saveTips(db, round, tips) {
  const col = db.collection(`${YEAR}_tips`);
  const bulkOps = [
    { updateMany: { filter: { User: MY_USER, Round: round }, update: { $set: { Active: 0 } } } },
    ...Object.entries(tips).map(([matchNum, tip]) => ({
      updateOne: {
        filter: { User: MY_USER, Round: round, MatchNumber: parseInt(matchNum) },
        update: { $set: { Team: tip.team, DeadCert: tip.deadCert || false, Active: 1, LastUpdated: new Date(), IsDefault: false } },
        upsert: true,
      }
    }))
  ];
  await col.bulkWrite(bulkOps, { ordered: false });
  try { await db.collection(`${YEAR}_tipping_ladder_cache`).deleteMany({ year: YEAR, upToRound: { $gte: round } }); } catch (_) {}
}

// ── Notify state (MongoDB-backed, no local file on Vercel) ────────────────────
// Dual-send: "early" (24h before lockout) and "final" (30min before lockout)
async function getNotifyState(db, round) {
  try {
    const doc = await db.collection("notify_state").findOne({ _id: "lockout_notifier" });
    return doc?.rounds?.[String(round)] || null; // { early: bool, final: bool }
  } catch (_) { return null; }
}
async function markRoundNotified(db, round, sendType) {
  try {
    await db.collection("notify_state").updateOne(
      { _id: "lockout_notifier" },
      { $set: { [`rounds.${round}.${sendType}`]: true, lastNotified: new Date() } },
      { upsert: true }
    );
  } catch (_) {}
}

// ── Telegram send ─────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${data.description}`);
  return true;
}

// ── Message builder ───────────────────────────────────────────────────────────
function buildMessage({ round, lockout, result, autoExcluded, byePlayers, selectionStatus, tipSuggestions, savedTeam, savedTips, dry, injuries, isFinal }) {
  const lines = [];
  const hrs  = Math.floor(Math.abs(lockout.minsUntil) / 60);
  const mins = Math.abs(lockout.minsUntil) % 60;
  const timeStr = lockout.locked ? `LOCKED` : `${lockout.melbTime} (${hrs}h ${mins}m)`;

  const phaseTag = isFinal ? " ⚡ FINAL Update" : " 👀 Early Preview";
  lines.push(`🦆⚡ *DuzzaTip Rd${round} —${phaseTag}*`);
  lines.push(`⏰ ${timeStr}`);
  if (dry) lines.push(`_(dry-run — nothing saved)_`);
  lines.push("");

  // ── Team ──
  let totalPts = 0;
  const teamLines = [];
  for (const pos of MAIN_POSITIONS) {
    const p = result.lineup[pos];
    if (!p) { teamLines.push(`*${POS_SHORT[pos]}* — (no player)`); continue; }
    const pts = p.scores[pos] ? Math.round(p.scores[pos]) : "?";
    if (typeof pts === "number") totalPts += pts;
    const injTag = injSeverity(p.name, injuries) >= 1 ? ` ⚠` : "";
    const srcTag = p.statsSource ? ` _[${p.statsSource}]_` : "";
    teamLines.push(`*${POS_SHORT[pos]}* — *${dn(p.name)}* _(${pts}pts)_${injTag}${srcTag}`);
  }
  lines.push(`📋 *YOUR TEAM* — _~${totalPts}pts projected_`);
  for (const l of teamLines) lines.push(l);
  if (result.bench) {
    const gainStr = result.benchExpectedGain > 0 ? ` _(+${result.benchExpectedGain}pts exp)_` : "";
    lines.push(`🪑 *Bench* — *${dn(result.bench.name)}* → ${POS_SHORT[result.benchBackup] || "?"}${gainStr}`);
  }
  if (result.reserveA) lines.push(`🅰 *Res A* — *${dn(result.reserveA.name)}*`);
  if (result.reserveB) lines.push(`🅱 *Res B* — *${dn(result.reserveB.name)}*`);
  lines.push("");

  // ── Alerts ──
  const alerts = [];
  for (const p of (byePlayers || [])) alerts.push(`🚫 *BYE* ${dn(p.name)} (${p.team})`);
  if (selectionStatus) {
    for (const [name, sel] of selectionStatus.entries()) {
      if (autoExcluded.has(name) && !(byePlayers || []).some(p => p.name === name)) {
        const inj = findInjury(name, injuries);
        alerts.push(`✗ *OUT* ${dn(name)}${inj ? ` — ${inj.detail}` : ""}`);
      } else if (sel === "emergency") {
        alerts.push(`⚡ *EMERG* ${dn(name)} — named emergency`);
      }
    }
    const allInLineup = [...Object.values(result.lineup), result.bench, result.reserveA, result.reserveB].filter(Boolean);
    for (const p of allInLineup) {
      if (injSeverity(p.name, injuries) >= 1 && !autoExcluded.has(p.name)) {
        const inj = findInjury(p.name, injuries);
        const sel = selectionStatus?.get(p.name);
        const namedTag = sel === "playing" ? " ✅ NAMED" : sel === "emergency" ? "" : "";
        alerts.push(`⚠ *DOUBT* ${dn(p.name)} — ${inj?.detail || "?"}${namedTag}`);
      }
    }
  }
  if (alerts.length > 0) {
    lines.push(`⚠️ *ALERTS*`);
    for (const a of alerts) lines.push(a);
    lines.push("");
  }

  // ── Tips ──
  if (tipSuggestions?.length) {
    lines.push(`🏈 *TIPS — Round ${round}*`);
    lines.push("");
    for (const t of tipSuggestions) {
      const dc = t.suggestDC ? " 💀 *DC*" : "";
      const home = t.favourite === t.homeTeam;
      const matchup = home
        ? `*${t.homeTeam}* v ${t.awayTeam}`
        : `${t.homeTeam} v *${t.awayTeam}*`;
      const oddsStr = t.homeOdds && t.awayOdds
        ? `  _($${t.homeOdds.toFixed(2)} / $${t.awayOdds.toFixed(2)})_`
        : "";
      lines.push(`*Pick:* *${t.favourite}*  ${t.confidence}%${dc}${oddsStr}`);
      lines.push(`${matchup}`);
      lines.push(`_${formatGameTime(t.dateUtc)}_`);
      lines.push("");
    }
  }

  lines.push(dry ? `_(dry-run: nothing saved)_` :
    savedTeam && savedTips ? `✅ Team + tips saved` :
    savedTeam ? `✅ Team saved  ⚠ Tips not saved` :
    savedTips ? `⚠ Team not saved  ✅ Tips saved` : `⚠ Nothing saved`);

  return lines.join("\n");
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function checkAuth(request) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret) return true; // no secret configured — open (not recommended)
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  const { searchParams } = new URL(request.url);
  if (searchParams.get("token") === secret) return true;
  return false;
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GET /api/lockout-notify?probe=1  — just check if teams are announced
// GET /api/lockout-notify          — same as POST (for easy browser testing with ?force=1&token=...)
export async function GET(request) {
  return handler(request);
}
export async function POST(request) {
  return handler(request);
}

async function handler(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force    = searchParams.get("force") === "1";
  const dry      = searchParams.get("dry")   === "1";
  const probe    = searchParams.get("probe") === "1";
  // preteams=1: allow lineup generation before AFL team selections are announced.
  // Still excludes bye players and long-term injuries (MONTHS/SEASON), but does NOT exclude "out" based on team selection.
  const preteams = searchParams.get("preteams") === "1";
  const roundArg = searchParams.get("round") ? parseInt(searchParams.get("round")) : null;

  const fixtures = loadFixtures();
  const round    = roundArg ?? getCurrentRound(fixtures);
  const lockout  = getLockoutInfo(fixtures, round);

  // ── Probe mode: just report whether teams are announced ──
  if (probe) {
    const { teamsFound, ppCount } = await fetchAFLTeamSelections(round);
    return Response.json({
      round, teamsFound, ppCount,
      announced: teamsFound >= 2,
      allTeams: teamsFound >= 5,
      lockout: lockout ? { melbTime: lockout.melbTime, hoursUntil: Math.round(lockout.hoursUntil), locked: lockout.locked } : null,
    });
  }

  const { db } = await connectToDatabase();
  const injuries = await loadInjuries(db);

  // ── Time gate (dual-send: early + final) ──
  let sendType = null; // "early" or "final"
  if (!force && !dry) {
    if (lockout?.locked) return Response.json({ skipped: true, reason: "round already locked" });
    if (lockout && lockout.hoursUntil > NOTIFY_WINDOW_HOURS)
      return Response.json({ skipped: true, reason: `lockout ${Math.round(lockout.hoursUntil)}h away (>${NOTIFY_WINDOW_HOURS}h window)` });

    const isFinalWindow = lockout && lockout.minsUntil <= FINAL_WINDOW_MINS;
    sendType = isFinalWindow ? "final" : "early";

    const prevNotify = await getNotifyState(db, round);
    if (prevNotify) {
      if (sendType === "early" && prevNotify.early)
        return Response.json({ skipped: true, reason: `already sent early preview for round ${round}` });
      if (sendType === "final" && prevNotify.final)
        return Response.json({ skipped: true, reason: `already sent final update for round ${round}` });
    }
  } else {
    // force or dry — determine sendType for message display
    const isFinalWindow = lockout && lockout.minsUntil <= FINAL_WINDOW_MINS;
    sendType = isFinalWindow ? "final" : "early";
  }

  // ── Squad ──
  const squadDocs = await db.collection(`${YEAR}_squads`).find({ user_id: MY_USER, Active: 1 }).toArray();
  if (!squadDocs.length) return Response.json({ error: "No squad found" }, { status: 500 });

  // ── Stats ──
  const statsMap = await loadPlayerStats(db, squadDocs.map(p => p.player_name));
  const squad = squadDocs.map((p, idx) => {
    const s = statsMap[p.player_name];
    const scores = s ? scoreAllPositions(s.avg) : {};
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return {
      name: p.player_name,
      team: p.team,
      scores,
      statsSource: s?.source || null,
      bestPos: best?.[0] || null,
      bestScore: best?.[1] || 0,
      squadIndex: idx,
    };
  });

  // ── Blend 2025 position scores when pre-season or data missing ──
  // Fetch 2025 scores if preteams=1 OR any squad player has no 2026 stats yet
  const need2025 = preteams || squad.some(p => Object.keys(p.scores).length === 0);
  if (need2025) {
    const scores2025ByName = await fetchSquad2025Scores();
    const BLEND_MAX = 10; // after 10 2026 games, fully trust 2026 data
    for (const p of squad) {
      const entry25 = scores2025ByName[(p.name || "").toLowerCase().trim()];
      if (!entry25) continue;
      // How many 2026 games does this player have? (parsed from statsSource "2026(5g)")
      const games2026 = (() => {
        const m = (statsMap[p.name]?.source || "").match(/2026\((\d+)g\)/);
        return m ? parseInt(m[1]) : 0;
      })();
      const w = Math.min(games2026, BLEND_MAX) / BLEND_MAX; // 0 = pure 2025, 1 = pure 2026
      const blended = {};
      for (const pos of MAIN_POSITIONS) {
        const s26 = p.scores[pos] ?? 0;
        const s25 = entry25.scores[pos] ?? 0;
        blended[pos] = Math.round((w * s26 + (1 - w) * s25) * 10) / 10;
      }
      p.scores = blended;
      p.statsSource = w === 0 ? `2025(${entry25.games}g)`
        : w >= 1             ? p.statsSource
        :                      `blend(${games2026}+${entry25.games}g)`;
      const best = Object.entries(blended).sort((a, b) => b[1] - a[1])[0];
      p.bestPos   = best?.[0] || null;
      p.bestScore = best?.[1] || 0;
    }
  }

  // ── Team selections + bye ──
  const roundFixtures = getRoundFixtures(fixtures, round);
  const playingTeams  = getPlayingTeams(roundFixtures);
  const byePlayers    = squad.filter(p => !teamIsPlaying(p.team, playingTeams));

  const { selections: fwSelections, teamsFound } = await fetchAFLTeamSelections(round);
  const selectionStatus = fwSelections ? buildSelectionStatus(squad, fwSelections) : null;
  const effectiveSelectionStatus = preteams ? null : selectionStatus;

  // ── Re-check dedup (sendType already determined above) ──

  // ── Auto-exclude ──
  // Exclude: bye players, serious injuries, and anyone NOT named in team selections
  const autoExcluded = new Set();
  for (const p of squad) {
    if (!teamIsPlaying(p.team, playingTeams)) autoExcluded.add(p.name);
    else if (injSeverity(p.name, injuries) >= 3) autoExcluded.add(p.name);
    else if (effectiveSelectionStatus) {
      const sel = effectiveSelectionStatus.get(p.name);
      // Only include players confirmed as "playing"; exclude "out", "emergency", "unknown"
      if (sel && sel !== "playing") autoExcluded.add(p.name);
    }
  }

  // ── Lineup + tips ──
  const result = findOptimalLineup(squad, autoExcluded);

  // ── Variance-based bench player + backup selection ──
  // Re-pick bench from all remaining eligible players (not just the one findOptimalLineup chose).
  // For each candidate × each backup position, compute E[max(bench,main)−main].
  // Pick the (player, position) pair with the highest expected gain, then re-pick ResA/ResB.
  {
    const mainAssigned = new Set(Object.values(result.lineup).filter(Boolean).map(p => p.name));
    const remainingPool = squad.filter(p => !autoExcluded.has(p.name) && !mainAssigned.has(p.name));

    let bestBench = null, bestBackup = null, bestGain = -Infinity;
    for (const candidate of remainingPool) {
      const candidateGames = statsMap[candidate.name]?.games || [];
      for (const pos of MAIN_POSITIONS) {
        const mainPlayer = result.lineup[pos];
        if (!mainPlayer) continue;
        const mainGames = statsMap[mainPlayer.name]?.games || [];
        const gain = expectedBenchGain(candidateGames, mainGames, pos);
        if (gain > bestGain) { bestGain = gain; bestBench = candidate; bestBackup = pos; }
      }
    }

    if (bestBench) {
      result.bench            = bestBench;
      result.benchBackup      = bestBackup;
      result.benchExpectedGain = Math.round(bestGain * 10) / 10;

      // Re-pick ResA / ResB from players not used as bench
      const afterBench = remainingPool.filter(p => p.name !== bestBench.name);
      const resAScore  = p => Math.max(...RESERVE_A_COVERS.map(pos => p.scores[pos] || 0));
      const resBScore  = p => Math.max(...RESERVE_B_COVERS.map(pos => p.scores[pos] || 0));
      result.reserveA = [...afterBench].sort((a, b) => resAScore(b) - resAScore(a))[0] || null;
      const afterResA  = afterBench.filter(p => p.name !== result.reserveA?.name);
      result.reserveB = [...afterResA].sort((a, b) => resBScore(b) - resBScore(a))[0] || null;
    }
  }
  const [squiggleTips, sportsbetOdds] = await Promise.all([
    fetchSquiggleTips(round),
    fetchSportsbetOdds(),
  ]);
  const tipSuggestions = buildTipSuggestions(roundFixtures, squiggleTips, sportsbetOdds);

  // ── Save ──
  let savedTeam = false, savedTips = false;
  if (!dry) {
    try { await saveTeamSelection(db, round, result); savedTeam = true; } catch (_) {}
    try {
      const tipsToSave = Object.fromEntries(tipSuggestions.map(t => [t.matchNumber, { team: t.favourite, deadCert: !!t.suggestDC }]));
      await saveTips(db, round, tipsToSave);
      savedTips = true;
    } catch (_) {}
  }

  // ── Send ──
  const isFinal = sendType === "final";
  const message = buildMessage({ round, lockout, result, autoExcluded, byePlayers, selectionStatus: effectiveSelectionStatus, tipSuggestions, savedTeam, savedTips, dry, injuries, isFinal });
  let sent = false;
  if (!dry) {
    try { await sendTelegram(message); sent = true; } catch (e) { console.error("Telegram:", e.message); }
  }

  // ── Record ──
  if (!dry && !force && sent) await markRoundNotified(db, round, sendType);

  return Response.json({
    ok: true, round, dry, teamsFound,
    autoExcluded: [...autoExcluded],
    byePlayers: byePlayers.map(p => p.name),
    savedTeam, savedTips, sent,
    lineup: Object.fromEntries(MAIN_POSITIONS.map(pos => [pos, result.lineup[pos]?.name || null])),
    tips: tipSuggestions.map(t => ({ match: `${t.homeTeam} v ${t.awayTeam}`, tip: t.favourite, confidence: t.confidence, dc: !!t.suggestDC, homeOdds: t.homeOdds, awayOdds: t.awayOdds, source: t.source })),
    preview: dry ? message : undefined,
  });
}

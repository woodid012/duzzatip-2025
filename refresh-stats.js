#!/usr/bin/env node
/**
 * DuzzaTip — Post-game player-stats refresh 🦆⚡
 *
 * Pulls FINAL player stats from the official AFL API for concluded games and
 * writes them to MongoDB <YEAR>_game_results, overwriting any stale mid-game
 * snapshot.
 *
 * WHY THIS EXISTS
 * The app's stats refresh (fixtureCache.js → refreshGameResultsForRound) is
 * opportunistic: it only fires on a page load that happens to catch a round as
 * LIVE, is throttled to once / 5 min, and the liveOnly merge path deliberately
 * SKIPS concluded games. So a game that goes live, gets a half-time snapshot,
 * then concludes WITHOUT another full refresh keeps the half-time numbers
 * forever. (Round 16 2026: every Brisbane v Sydney player was frozen at a
 * 11:10Z half-time capture — Logan McDonald showed 1 kick instead of his final
 * 2, missing a goal.) Nothing guaranteed a post-game re-sync.
 *
 * This closes that gap: a deterministic pass that re-pulls any concluded game
 * whose stored rows are missing or were captured before the game ended. It runs
 * at the start of every lockout-notify invocation (the notifier already does
 * the AFL token handshake and runs reliably all weekend), and standalone via
 * `npm run stats:refresh`.
 *
 * SOURCE OF TRUTH: the official AFL API playerStats endpoint — the same one the
 * app's refreshGameResults.js uses; the field mapping here mirrors it exactly.
 *
 * Usage:
 *   node refresh-stats.js                 — auto: refresh current + previous round
 *   node refresh-stats.js --round=16      — a specific round
 *   node refresh-stats.js --round=16 --force  — re-pull even rows that look final
 *   node refresh-stats.js --dry-run       — report what's stale, write nothing
 *   npm run stats:refresh
 */

require("dotenv").config({ path: ".env.local" });

const { MongoClient } = require("mongodb");
const { AFL_COMP_SEASON_ID, getAFLToken } = require("./src/app/lib/lockoutShared");

const YEAR = 2026;
const MONGODB_URI = process.env.MONGODB_URI ||
  "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

// A concluded game's stats are "final-captured" only if its stored rows were
// written AFTER the game ended. AFL matches run ~2.5h; allow a 3h buffer so a
// genuine post-siren capture is never mistaken for a live snapshot.
const GAME_LENGTH_MS = 3 * 60 * 60 * 1000;

async function fetchMatches(token, round) {
  const res = await fetch(
    `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${round}&pageSize=20`,
    { headers: { "x-media-mis-token": token }, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`AFL matches HTTP ${res.status}`);
  return (await res.json()).matches || [];
}

// Mirror of refreshGameResults.js mapping — one row per player for a single match.
function mapMatchPlayers(statsData, match, round) {
  const homeTeamName = match.home?.team?.club?.name || match.home?.team?.name || "";
  const awayTeamName = match.away?.team?.club?.name || match.away?.team?.name || "";
  const rows = [];
  for (const side of ["homeTeamPlayerStats", "awayTeamPlayerStats"]) {
    const isHome = side === "homeTeamPlayerStats";
    const teamName = isHome ? homeTeamName : awayTeamName;
    const opponent = isHome ? awayTeamName : homeTeamName;
    for (const p of (statsData[side] || [])) {
      const pn = p.player?.player?.player?.playerName;
      const st = p.playerStats?.stats;
      if (!pn || !st) continue;
      const ext = st.extendedStats || {};
      rows.push({
        player_name: `${pn.givenName} ${pn.surname}`,
        team_name: teamName,
        opp: opponent,
        round,
        year: YEAR,
        match_date: match.utcStartTime ? match.utcStartTime.split("T")[0] : new Date().toISOString().split("T")[0],
        kicks: Number(st.kicks) || 0,
        handballs: Number(st.handballs) || 0,
        disposals: Number(st.disposals) || 0,
        marks: Number(st.marks) || 0,
        tackles: Number(st.tackles) || 0,
        hitouts: Number(st.hitouts) || 0,
        freesFor: Number(st.freesFor) || 0,
        freesAgainst: Number(st.freesAgainst) || 0,
        goals: Number(st.goals) || 0,
        behinds: Number(st.behinds) || 0,
        centreBounceAttendances: Number(ext.centreBounceAttendances) || 0,
        kickIns: Number(ext.kickins) || 0,
        kickInsPlayon: Number(ext.kickinsPlayon) || 0,
        timeOnGroundPercentage: Number(st.timeOnGroundPercentage) || 0,
        dreamTeamPoints: Number(st.dreamTeamPoints) || 0,
        SC: 0,
        match_number: match.matchId || (100 + round),
        startingPosition: "",
        created_at: new Date(),
      });
    }
  }
  return rows;
}

/**
 * @returns {Promise<{ok:boolean, reason?:string, refreshed:Array<{round,match,players}>}>}
 *   ok=false → AFL API unreachable; existing stored stats are left untouched.
 */
async function refreshStats({
  rounds,
  year = YEAR,
  mongoUri = MONGODB_URI,
  write = true,
  force = false,
  verbose = true,
} = {}) {
  const log  = (...a) => { if (verbose) console.log(...a); };
  const warn = (...a) => { if (verbose) console.warn(...a); };

  let token;
  try {
    token = await getAFLToken();
  } catch (e) {
    warn(`⚠ AFL token failed (${e.message}) — stats left unchanged.`);
    return { ok: false, reason: "token", refreshed: [] };
  }

  let client;
  const refreshed = [];
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    const col = client.db("afl_database").collection(`${year}_game_results`);

    for (const round of rounds) {
      let matches;
      try {
        matches = await fetchMatches(token, round);
      } catch (e) {
        warn(`⚠ Round ${round} matches fetch failed: ${e.message}`);
        continue;
      }

      for (const match of matches) {
        if (match.status !== "CONCLUDED") continue;
        const homeTeam = match.home?.team?.club?.name || match.home?.team?.name || "";
        const awayTeam = match.away?.team?.club?.name || match.away?.team?.name || "";
        const label = `${homeTeam} v ${awayTeam}`;

        // Is the stored capture already final? (rows exist and all were written
        // after the game ended). Skip unless --force.
        if (!force) {
          const stored = await col.find(
            { round, year, team_name: { $in: [homeTeam, awayTeam] } },
            { projection: { created_at: 1 } }
          ).toArray();
          const gameEnd = match.utcStartTime ? new Date(match.utcStartTime).getTime() + GAME_LENGTH_MS : 0;
          const allFinal = stored.length > 0 && gameEnd > 0 &&
            stored.every(r => new Date(r.created_at).getTime() >= gameEnd);
          if (allFinal) continue; // already have final stats for this game
        }

        // Pull final stats for this game.
        let players;
        try {
          const sr = await fetch(`https://api.afl.com.au/cfs/afl/playerStats/match/${match.providerId}`,
            { headers: { "x-media-mis-token": token }, signal: AbortSignal.timeout(10000) });
          if (!sr.ok) { warn(`⚠ ${label}: stats HTTP ${sr.status}`); continue; }
          players = mapMatchPlayers(await sr.json(), match, round);
        } catch (e) {
          warn(`⚠ ${label}: stats fetch failed (${e.message})`); continue;
        }

        // Guard: never wipe a stored game on an empty/degraded response.
        if (players.length === 0) { warn(`⚠ ${label}: AFL returned 0 players — left unchanged.`); continue; }

        log(`   R${round} ${label}: ${players.length} final player stat(s)${write ? "" : " (dry-run)"}`);
        refreshed.push({ round, match: label, players: players.length });

        if (write) {
          // Per-game merge: replace only these two teams' rows for this round, so
          // we never disturb other games in the round.
          await col.deleteMany({ round, year, team_name: { $in: [homeTeam, awayTeam] } });
          await col.insertMany(players);
        }
      }
    }
  } catch (e) {
    warn(`⚠ Stats refresh error: ${e.message}`);
    return { ok: false, reason: "db", refreshed };
  } finally {
    if (client) await client.close();
  }

  return { ok: true, refreshed };
}

module.exports = { refreshStats, mapMatchPlayers };

// ── CLI entry ────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const roundArg = args.find(a => a.startsWith("--round="));

  // Default: current + previous round (the previous round's final Sunday game
  // can conclude after the last app load; the next notifier run heals it).
  let rounds;
  if (roundArg) {
    rounds = [parseInt(roundArg.split("=")[1], 10)];
  } else {
    const fx = require("./public/afl-2026.json");
    const now = new Date();
    const upcoming = fx.filter(f => f.RoundNumber > 0 && new Date(f.DateUtc) > now)
      .sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));
    const cur = upcoming.length ? upcoming[0].RoundNumber : Math.max(...fx.map(f => f.RoundNumber));
    rounds = cur > 1 ? [cur - 1, cur] : [cur];
  }

  refreshStats({ rounds, write: !dryRun, force, verbose: true })
    .then(r => {
      if (r.ok && r.refreshed.length === 0) console.log("✓ All concluded games already have final stats.");
      else if (r.ok) console.log(`✓ Refreshed ${r.refreshed.length} concluded game(s)${dryRun ? " (dry-run — nothing written)" : ""}.`);
      process.exit(r.ok ? 0 : 1);
    })
    .catch(e => { console.error("Stats refresh error:", e.message); process.exit(1); });
}

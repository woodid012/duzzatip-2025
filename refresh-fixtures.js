#!/usr/bin/env node
/**
 * DuzzaTip — Fixture date refresh 🦆⚡
 *
 * Pulls the authoritative match schedule from the official AFL API and corrects
 * the kickoff date/time (DateUtc) of every fixture, in both:
 *   • public/afl-<YEAR>.json   (read directly by the CLI lockout notifier)
 *   • MongoDB <YEAR>_fixtures   (read by the Next.js app, seeded once from the JSON)
 *
 * WHY THIS EXISTS
 * The fixture JSON was seeded once at the start of the season. At that point the
 * AFL had only published exact dates/times for the early rounds — later rounds
 * carried placeholder slots (every game dumped on the round's Saturday at
 * 02:00/02:30/04:00Z). Nothing in the pipeline ever refreshed fixture DATES
 * (the AFL-API overlay only patches SCORES), so when the AFL released the real
 * times the placeholders went stale. getLockoutInfo() then computed a lockout
 * ~40h later than reality, which pushed the round outside the notifier's window
 * gate and silently skipped the weekly alert. The AFL also routinely moves games
 * for broadcast/ladder reasons all season, so a one-off fix is not enough — this
 * runs every notifier invocation (and on demand) to self-heal.
 *
 * SOURCE OF TRUTH: the official AFL API (api.afl.com.au / aflapi.afl.com.au) —
 * the same endpoint the app already uses for scores and team selections. The
 * AFL API exposes team.club.name in the SAME form as our fixture file, so we
 * canonicalise both sides through the shared slug helpers (zero name mapping to
 * drift). Squiggle is deliberately NOT used here — it is a tips source, not an
 * authoritative fixture source.
 *
 * Usage:
 *   node refresh-fixtures.js            — refresh JSON + MongoDB
 *   node refresh-fixtures.js --dry-run  — show what would change, write nothing
 *   node refresh-fixtures.js --no-mongo — update the JSON file only
 *   npm run fixtures:refresh
 */

require("dotenv").config({ path: ".env.local" });

const fs   = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const {
  AFL_COMP_SEASON_ID,
  getAFLToken,
  aflTeamNameToSlug,
  findTeamSlug,
} = require("./src/app/lib/lockoutShared");

const YEAR = 2026;
const MONGODB_URI = process.env.MONGODB_URI ||
  "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

// AFL "2026-06-25T09:30:00.000+0000" → file format "2026-06-25 09:30:00Z" (UTC).
function toFileDate(utcStartTime) {
  const iso = new Date(utcStartTime).toISOString(); // normalises to "...Z"
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
}

function matchKey(round, homeSlug, awaySlug) {
  return `${round}|${homeSlug}|${awaySlug}`;
}

async function fetchAflRound(token, apiRound) {
  const res = await fetch(
    `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${apiRound}&pageSize=30`,
    { headers: { "x-media-mis-token": token }, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`AFL matches HTTP ${res.status}`);
  const data = await res.json();
  return data.matches || [];
}

/**
 * Refresh fixture dates from the AFL API.
 * @returns {Promise<{ok:boolean, reason?:string, changes:Array}>}
 *   ok=false means the AFL API was unreachable / returned nothing — callers
 *   should treat the existing fixture file as still-authoritative and carry on.
 */
async function refreshFixtures({
  year = YEAR,
  mongoUri = MONGODB_URI,
  write = true,
  updateMongo = true,
  verbose = true,
} = {}) {
  const log  = (...a) => { if (verbose) console.log(...a); };
  const warn = (...a) => { if (verbose) console.warn(...a); };

  const fixturesPath = path.join(__dirname, "public", `afl-${year}.json`);
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
  const rounds = [...new Set(fixtures.map(f => f.RoundNumber))].filter(r => r >= 0).sort((a, b) => a - b);

  let token;
  try {
    token = await getAFLToken();
  } catch (e) {
    warn(`⚠ AFL token failed (${e.message}) — fixtures left unchanged.`);
    return { ok: false, reason: "token", changes: [] };
  }

  // The AFL API may number rounds with a +1 offset (e.g. Opening Round = 1, not
  // 0). Detect it the same way fixtureCache does: if API round 0 has no matches,
  // our round N maps to API round N+1.
  let offset = 0;
  try {
    const r0 = await fetchAflRound(token, 0);
    if (r0.length === 0) offset = 1;
  } catch { offset = 0; }

  // Build authoritative date map across every round in the file.
  const aflMap = new Map(); // key → { utc, status }
  for (const r of rounds) {
    try {
      const matches = await fetchAflRound(token, r + offset);
      for (const m of matches) {
        if (!m.utcStartTime) continue;
        // Prefer team.club.name (stable English) over team.name (AFL rotates
        // this through Indigenous-language variants during themed rounds).
        const homeName = m.home?.team?.club?.name || m.home?.team?.name;
        const awayName = m.away?.team?.club?.name || m.away?.team?.name;
        const hs = aflTeamNameToSlug(homeName);
        const as = aflTeamNameToSlug(awayName);
        if (!hs || !as) continue;
        aflMap.set(matchKey(r, hs, as), { utc: toFileDate(m.utcStartTime), status: m.status });
      }
    } catch (e) {
      warn(`⚠ AFL round ${r} fetch failed: ${e.message}`);
    }
  }

  // Refuse to do anything if the API gave us nothing — never blank out a good
  // file on a transient outage.
  if (aflMap.size === 0) {
    warn("⚠ AFL API returned no fixtures — file left unchanged.");
    return { ok: false, reason: "empty", changes: [] };
  }

  // Apply corrections (DateUtc only — venue/teams are left as-is to avoid
  // naming-convention churn; the lockout bug is purely about dates).
  const changes = [];
  let matched = 0;
  for (const f of fixtures) {
    const hs = findTeamSlug(f.HomeTeam);
    const as = findTeamSlug(f.AwayTeam);
    if (!hs || !as) continue;
    const afl = aflMap.get(matchKey(f.RoundNumber, hs, as));
    if (!afl) continue;
    matched++;
    if (afl.utc !== f.DateUtc) {
      changes.push({
        MatchNumber: f.MatchNumber, round: f.RoundNumber,
        home: f.HomeTeam, away: f.AwayTeam, from: f.DateUtc, to: afl.utc,
      });
      f.DateUtc = afl.utc;
    }
  }

  log(`AFL API: matched ${matched}/${fixtures.length} fixtures, ${changes.length} date change(s).`);

  if (changes.length === 0) {
    return { ok: true, changes: [] };
  }

  for (const c of changes) {
    log(`   R${c.round} ${c.home} v ${c.away}: ${c.from} → ${c.to}`);
  }

  if (write) {
    fs.writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2) + "\n");
    log(`✓ Wrote ${changes.length} change(s) to public/afl-${year}.json`);
  }

  if (updateMongo) {
    let client;
    try {
      client = new MongoClient(mongoUri);
      await client.connect();
      const col = client.db("afl_database").collection(`${year}_fixtures`);
      const ops = changes.map(c => ({
        updateOne: { filter: { MatchNumber: c.MatchNumber, year }, update: { $set: { DateUtc: c.to } } },
      }));
      const res = await col.bulkWrite(ops, { ordered: false });
      log(`✓ Updated ${res.modifiedCount} fixture date(s) in MongoDB ${year}_fixtures`);
    } catch (e) {
      warn(`⚠ MongoDB fixture update failed (${e.message}) — JSON file still updated.`);
    } finally {
      if (client) await client.close();
    }
  }

  return { ok: true, changes };
}

module.exports = { refreshFixtures, toFileDate };

// ── CLI entry ────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  refreshFixtures({
    write: !dryRun,
    updateMongo: !dryRun && !args.includes("--no-mongo"),
  })
    .then(r => {
      if (r.ok && r.changes.length === 0) console.log("✓ Fixtures already up to date.");
      if (dryRun) console.log("(dry-run — nothing written)");
      process.exit(0);
    })
    .catch(e => { console.error("Fixture refresh error:", e.message); process.exit(1); });
}

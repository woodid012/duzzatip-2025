// Ring-fenced finals-fixture sync for Duzza Finals.
//
// The season pipeline never INSERTS fixtures: `${year}_fixtures` is seeded
// once from public/afl-{year}.json (which ends at round 24) and every refresh
// path only updates existing rows. Finals rounds (25-29: wildcard through the
// Grand Final) therefore have to be pulled in here — confirmed matchups are
// upserted as they firm up (wildcard winners resolve placeholder slots), and
// scores/dates are kept fresh on subsequent runs.
//
// Deliberately self-contained (own AFL token fetch, own name normalisation)
// rather than reaching into fixtureCache's private helpers, per this comp's
// ring-fencing rule.
import { DUZZA_FINALS_ABBREV_TO_FULL } from './duzzaFinals';

const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership
const SYNC_ROUNDS = [25, 26, 27, 28, 29]; // wildcard + the four finals weeks
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

let lastSyncAt = 0;
let syncInFlight = null;

// Normalised club name -> canonical full name as stored in ${year}_fixtures
// (the values of the abbrev map are the canonical spellings, e.g.
// "Gold Coast SUNS"). AFL API club names differ in casing/nicknames, so
// compare on lowercase alphanumerics only.
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const CANONICAL_BY_NORM = {};
for (const full of Object.values(DUZZA_FINALS_ABBREV_TO_FULL)) {
  CANONICAL_BY_NORM[norm(full)] = full;
}

function toCanonicalClub(apiName) {
  return CANONICAL_BY_NORM[norm(apiName)] || null;
}

// AFL "2026-09-03T10:10:00.000+0000" -> stored "2026-09-03 10:10:00Z",
// matching refresh-fixtures.js so nothing flip-flops formats.
function toFixtureDate(utcStartTime) {
  const iso = new Date(utcStartTime).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
}

async function fetchAflToken() {
  const res = await fetch('https://api.afl.com.au/cfs/afl/WMCTok', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://www.afl.com.au' },
    body: '{}',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AFL token HTTP ${res.status}`);
  const { token } = await res.json();
  return token;
}

async function fetchRoundMatches(token, round) {
  const res = await fetch(
    `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${round}&pageSize=30`,
    { headers: { 'x-media-mis-token': token }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`AFL matches HTTP ${res.status}`);
  const data = await res.json();
  return data.matches || [];
}

async function runSync(seasonDb, year) {
  const token = await fetchAflToken();
  const collection = seasonDb.collection(`${year}_fixtures`);

  const settled = await Promise.allSettled(
    SYNC_ROUNDS.map(async (round) => ({ round, matches: await fetchRoundMatches(token, round) }))
  );

  for (const outcome of settled) {
    if (outcome.status === 'rejected') continue;
    const { round, matches } = outcome.value;

    // Count existing rows once per round so newly-confirmed games (wildcard
    // winners slotting into placeholders) get the next stable MatchNumber in
    // the round's `${round}${nn}` range without renumbering earlier inserts.
    let existingInRound = await collection.countDocuments({ year, RoundNumber: round });

    for (const m of matches) {
      // Prefer club.name (stable English) over team.name, which the AFL
      // rotates through Indigenous-language variants during themed rounds.
      const home = toCanonicalClub(m.home?.team?.club?.name || m.home?.team?.name);
      const away = toCanonicalClub(m.away?.team?.club?.name || m.away?.team?.name);
      // Unresolved placeholder slots ("Winner of WF1") don't map to a club —
      // skip them; they upsert on a later run once the AFL confirms teams.
      if (!home || !away || !m.utcStartTime) continue;

      const homeScore = m.homeTeamScore?.matchScore?.totalScore ?? null;
      const awayScore = m.awayTeamScore?.matchScore?.totalScore ?? null;

      const result = await collection.updateOne(
        { year, RoundNumber: round, HomeTeam: home, AwayTeam: away },
        {
          $set: {
            DateUtc: toFixtureDate(m.utcStartTime),
            HomeTeamScore: homeScore,
            AwayTeamScore: awayScore,
          },
          $setOnInsert: {
            year,
            RoundNumber: round,
            HomeTeam: home,
            AwayTeam: away,
            // e.g. 2601, 2602 — disjoint from the season file's 1..N numbering
            // and stable for the life of the row (tips key on MatchNumber).
            MatchNumber: round * 100 + existingInRound + 1,
          },
        },
        { upsert: true }
      );
      if (result.upsertedCount > 0) existingInRound += 1;
    }
  }
}

// Throttled, never-throwing entry point — call from any duzza-finals API
// route. Shares one in-flight promise so concurrent requests don't stack
// sync passes.
export async function syncFinalsFixtures(seasonDb, year) {
  if (Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return;
  if (syncInFlight) {
    await syncInFlight.catch(() => {});
    return;
  }
  lastSyncAt = Date.now();
  syncInFlight = runSync(seasonDb, year)
    .catch((err) => console.warn(`Duzza Finals fixture sync failed: ${err.message}`))
    .finally(() => {
      syncInFlight = null;
    });
  await syncInFlight;
}

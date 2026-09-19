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
import { claimStamp } from './sharedCache';

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

    // Read the round's rows once so newly-confirmed games (wildcard winners
    // slotting into placeholders) get the next stable MatchNumber in the
    // round's `${round}${nn}` range without renumbering earlier inserts, and
    // so the whole round goes to Mongo as one bulkWrite instead of a write
    // per match.
    const existingRows = await collection
      .find({ year, RoundNumber: round }, { projection: { HomeTeam: 1, AwayTeam: 1, _id: 0 } })
      .toArray();
    let existingInRound = existingRows.length;
    const known = new Set(existingRows.map((r) => `${r.HomeTeam}|${r.AwayTeam}`));
    const ops = [];

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

      const key = `${home}|${away}`;
      const isNew = !known.has(key);
      if (isNew) {
        known.add(key);
        existingInRound += 1;
      }

      ops.push({
        updateOne: {
          filter: { year, RoundNumber: round, HomeTeam: home, AwayTeam: away },
          update: {
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
              MatchNumber: round * 100 + existingInRound,
            },
          },
          upsert: true,
        },
      });
    }

    if (ops.length > 0) await collection.bulkWrite(ops, { ordered: true });
  }
}

// Throttled, never-throwing entry point — call from any duzza-finals API
// route. Shares one in-flight promise so concurrent requests don't stack
// sync passes.
// How long one instance's sync stands in for everyone else's. Deliberately
// far shorter than the per-instance interval: the stamp is claimed before the
// AFL pull, so a claimant whose pull fails would otherwise block every
// instance for the whole interval — and this is the path a finals score lands
// by, which the week's dead certs and the next week's matchup wait on.
const SYNC_CLAIM_MS = 90 * 1000;

export async function syncFinalsFixtures(seasonDb, year) {
  if (Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return;
  if (syncInFlight) {
    await syncInFlight.catch(() => {});
    return;
  }
  // The throttle above is per instance; the stamp makes it hold across
  // instances, so a fleet of cold lambdas doesn't each pull the AFL feed.
  // Losing the claim doesn't spend this instance's interval — it gets another
  // go once the claim lapses, in case the claimant's pull failed.
  if (!(await claimStamp(`finals-fixture-sync:${year}`, SYNC_CLAIM_MS))) return;
  lastSyncAt = Date.now();
  syncInFlight = runSync(seasonDb, year)
    .catch((err) => {
      // A failed pull earns a retry on the next request, not in ten minutes.
      lastSyncAt = 0;
      console.warn(`Duzza Finals fixture sync failed: ${err.message}`);
    })
    .finally(() => {
      syncInFlight = null;
    });
  await syncInFlight;
}

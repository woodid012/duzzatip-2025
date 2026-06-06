// src/app/lib/fixtureCache.js
// Fixture source of truth: MongoDB {year}_fixtures collection.
// On first use, seeds from local JSON file.
// Scores are overlaid from the AFL API for started games and written back to MongoDB.

import { CURRENT_YEAR } from '@/app/lib/constants';
import { connectToDatabase } from '@/app/lib/mongodb';
import { refreshGameResultsForRound } from '@/app/lib/refreshGameResults';
import path from 'path';
import fs from 'fs/promises';

const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership

// Per-year cache
const fixtureCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Separate cache for round completion status (shorter TTL during live games)
const roundStatusCache = new Map();
const STATUS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Normalise team names for fuzzy matching between local file and AFL API.
// The AFL API switched to Indigenous-language names for several clubs in 2026
// (Walyalup, Yartapuulti, etc.); map those to the English equivalents first
// so the suffix-based replacements below produce a matching key.
function normaliseTeam(name = '') {
  let n = name.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');
  // Indigenous name → English equivalent (pre-suffix-rewrite)
  const indigenous = {
    walyalup: 'fremantle',
    yartapuulti: 'portadelaide',
    kuwarna: 'adelaidecrows',
    euroyroke: 'stkilda',
    narrm: 'melbourne',
    waalitjmarawar: 'westcoasteagles',
  };
  if (indigenous[n]) n = indigenous[n];
  return n
    .replace('suns', 'goldcoast')
    .replace('giants', 'gws')
    .replace('swans', 'sydney')
    .replace('lions', 'brisbane')
    .replace('eagles', 'westcoast')
    .replace('bulldogs', 'westernbulldogs')
    .replace('kangaroos', 'northmelbourne');
}

// Normalised "home|away" key for a fixture (orientation-sensitive — a return
// fixture with home/away swapped is a different key and never collides).
export function matchupKey(f) {
  return `${normaliseTeam(f.HomeTeam)}|${normaliseTeam(f.AwayTeam)}`;
}

// The set of matchup keys (home|away) that appear in more than one round with
// the SAME orientation. These are the only fixtures at risk of cross-round
// score contamination: under the old matchup-only score key, the second
// occurrence of e.g. "Hawthorn v Western Bulldogs" (rounds 5 and 13 of 2026)
// would inherit the other round's result. We re-validate them against their
// own round on every refresh so a stale value can't linger.
export function recurringMatchupKeys(fixtures) {
  const rounds = new Map(); // matchup -> Set(roundNumbers)
  for (const f of fixtures) {
    if (f.RoundNumber < 1) continue;
    const k = matchupKey(f);
    if (!rounds.has(k)) rounds.set(k, new Set());
    rounds.get(k).add(f.RoundNumber);
  }
  const recurring = new Set();
  for (const [k, rs] of rounds) if (rs.size > 1) recurring.add(k);
  return recurring;
}

// Apply AFL API scores to fixtures authoritatively, per round. combinedScores
// is keyed by `${round}|${homeNorm}|${awayNorm}`. For every fixture we have
// own-round API data for:
//   • concluded with a score          → set that score
//   • not yet concluded (live/sched.) → ensure the fixture holds NO score; if
//     it currently does, that's cross-round contamination from the old
//     matchup-only key, so clear it back to null.
// Fixtures with no own-round API entry are left untouched. Returns the new
// fixtures array plus the set of MatchNumbers we had authoritative data for
// (the caller only writes those back) and the matched-key set for diagnostics.
export function applyAflScores(fixtures, combinedScores) {
  const matchedKeys = new Set();
  const evaluated = new Set();
  let updated = 0;
  const result = fixtures.map(f => {
    const key = `${f.RoundNumber}|${matchupKey(f)}`;
    const score = combinedScores[key];
    if (!score) return f; // no own-round API data — leave as-is
    matchedKeys.add(key);
    evaluated.add(f.MatchNumber);

    const hasScore = score.homeScore !== null && score.awayScore !== null;
    if (hasScore) {
      if (f.HomeTeamScore !== score.homeScore || f.AwayTeamScore !== score.awayScore) updated++;
      return { ...f, HomeTeamScore: score.homeScore, AwayTeamScore: score.awayScore };
    }

    // Own-round game has no score yet. Only clear a stored value when the API
    // positively reports the game as not concluded (guards against briefly
    // wiping a real score during an API hiccup where status is unknown).
    const notConcluded = score.status && score.status !== 'CONCLUDED';
    if (notConcluded && (f.HomeTeamScore !== null || f.AwayTeamScore !== null)) {
      updated++;
      return { ...f, HomeTeamScore: null, AwayTeamScore: null };
    }
    return f;
  });
  return { fixtures: result, matchedKeys, evaluated, updated };
}

async function getAflToken() {
  const res = await fetch('https://api.afl.com.au/cfs/afl/WMCTok', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.afl.com.au' },
    body: '{}',
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`AFL token HTTP ${res.status}`);
  const { token } = await res.json();
  return token;
}

// Fetch AFL API matches for a given API round number and return a score map
// keyed by normalised "homeTeam|awayTeam".
async function fetchAflApiScoresForRound(apiRound, token) {
  const res = await fetch(
    `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${apiRound}&pageSize=20`,
    { headers: { 'x-media-mis-token': token }, signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) throw new Error(`AFL matches HTTP ${res.status}`);
  const data = await res.json();
  const matches = data.matches || [];

  const scoreMap = {};
  for (const m of matches) {
    // Prefer team.club.name (stable English name) over team.name, which the
    // AFL API rotates through Indigenous-language equivalents (Walyalup,
    // Yartapuulti, etc.). Fall back to team.name if club is missing.
    const homeApiName = m.home?.team?.club?.name || m.home?.team?.name;
    const awayApiName = m.away?.team?.club?.name || m.away?.team?.name;
    const homeNorm = normaliseTeam(homeApiName);
    const awayNorm = normaliseTeam(awayApiName);
    if (!homeNorm || !awayNorm) continue;

    // Score can live at different paths depending on API version
    const homeScore =
      m.home?.score?.totalScore ??
      m.homeTeamScore?.totalScore ??
      m.home?.totalScore ??
      null;
    const awayScore =
      m.away?.score?.totalScore ??
      m.awayTeamScore?.totalScore ??
      m.away?.totalScore ??
      null;

    const status = m.status || '';
    scoreMap[`${homeNorm}|${awayNorm}`] = {
      homeScore: homeScore !== null ? Number(homeScore) : null,
      awayScore: awayScore !== null ? Number(awayScore) : null,
      status,
    };
  }
  return { scoreMap, matchCount: matches.length };
}

// Overlay AFL API scores onto the local fixture array.
// The AFL API may use a different round offset (e.g. Opening Round = 1 not 0).
// We detect the offset by checking which API round returns matches that align
// with our local round 0 fixtures.
async function overlayAflScores(fixtures, year) {
  const now = Date.now();

  // Only fetch scores for rounds that have already started
  const startedRounds = [...new Set(
    fixtures
      .filter(f => new Date(f.DateUtc) <= now)
      .map(f => f.RoundNumber)
  )];

  if (startedRounds.length === 0) return fixtures;

  let token;
  try {
    token = await getAflToken();
  } catch (err) {
    console.warn(`AFL API token failed: ${err.message}`);
    return fixtures;
  }

  // Detect round offset: try fetching round 0 first; if empty, try round 1.
  // We test against our local round 0 (Opening Round).
  let roundOffset = 0;
  try {
    const { matchCount } = await fetchAflApiScoresForRound(0, token);
    if (matchCount === 0) {
      // AFL API starts at 1; our app starts at 0 — offset = +1
      roundOffset = 1;
      console.log(`AFL API uses 1-indexed rounds (Opening Round = 1), offset = ${roundOffset}`);
    }
  } catch {
    roundOffset = 1; // assume offset if detection fails
  }

  // Build a combined score map across all started rounds.
  // Keys are namespaced by local round (`${round}|home|away`) — NOT by team
  // matchup alone. The same fixture can recur in two rounds (e.g. Hawthorn v
  // Western Bulldogs plays in both round 5 and round 13 of 2026), and a bare
  // matchup key would let one round's result bleed onto the other round's
  // fixture (and get written back to MongoDB, permanently corrupting it).
  // Also track which local rounds have any LIVE matches — the AFL API
  // doesn't include a score field for LIVE matches (scores only appear once
  // status flips to CONCLUDED), so we can't rely on a "scores landed"
  // transition to trigger the player-stats refresh during a live game.
  const combinedScores = {};
  const liveRounds = new Set();
  for (const localRound of startedRounds) {
    const apiRound = localRound + roundOffset;
    try {
      const { scoreMap } = await fetchAflApiScoresForRound(apiRound, token);
      for (const [matchup, score] of Object.entries(scoreMap)) {
        combinedScores[`${localRound}|${matchup}`] = score;
      }
      if (Object.values(scoreMap).some(s => s.status === 'LIVE')) {
        liveRounds.add(localRound);
      }
    } catch (err) {
      console.warn(`AFL API scores failed for round ${apiRound}: ${err.message}`);
    }
  }

  // Apply scores to matching fixtures. The score key is namespaced by the
  // fixture's own round so a recurring matchup only ever picks up the score
  // from the round it actually belongs to — and a fixture left holding a stale
  // cross-round score gets cleared once we have its own round's status.
  const { fixtures: result, matchedKeys, evaluated, updated } = applyAflScores(fixtures, combinedScores);

  // Loud warning if AFL API returned scores we couldn't tie back to a fixture —
  // catches future team-name rotations (Indigenous rounds, rebrands) without us
  // noticing scores silently failing to land.
  const unmatchedApiKeys = Object.keys(combinedScores).filter(k => !matchedKeys.has(k));
  if (unmatchedApiKeys.length > 0) {
    console.warn(
      `AFL API: ${unmatchedApiKeys.length} match(es) had no fixture-side match. ` +
      `Unmatched keys: ${unmatchedApiKeys.join(', ')}. ` +
      `Check team.club.name in the AFL API response and the normaliseTeam mappings.`
    );
  }

  console.log(`AFL API: overlaid scores on ${updated}/${fixtures.length} fixtures`);
  return { fixtures: result, liveRounds, evaluated };
}

export async function getAflFixtures(year = CURRENT_YEAR) {
  const now = Date.now();
  const cached = fixtureCache.get(year);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  const { db } = await connectToDatabase();
  const collection = db.collection(`${year}_fixtures`);

  // Seed MongoDB from local file if collection is empty
  let count = await collection.countDocuments();
  if (count === 0) {
    const fixturesPath = path.join(process.cwd(), 'public', `afl-${year}.json`);
    try {
      const raw = await fs.readFile(fixturesPath, 'utf8');
      const seed = JSON.parse(raw).map(f => ({ ...f, year }));
      await collection.insertMany(seed);
      console.log(`Seeded ${seed.length} fixtures for ${year} into MongoDB`);
    } catch (err) {
      throw new Error(`Failed to seed fixtures for ${year}: ${err.message}`);
    }
  }

  // Load all fixtures from MongoDB
  let fixtures = await collection.find({}, { projection: { _id: 0 } }).toArray();

  // For current year, refresh scores from AFL API for games that have started
  // but don't yet have both scores recorded.
  if (year === CURRENT_YEAR) {
    // Re-validate a started fixture when it's missing a score OR when its
    // matchup recurs in another round — the latter can be holding a stale
    // cross-round result that must be checked against its own round and cleared.
    const recurring = recurringMatchupKeys(fixtures);
    const needsScore = fixtures.filter(f => {
      if (new Date(f.DateUtc) > now) return false;
      if (f.HomeTeamScore === null || f.AwayTeamScore === null) return true;
      return recurring.has(matchupKey(f));
    });

    if (needsScore.length > 0) {
      try {
        const { fixtures: updated, liveRounds, evaluated } = await overlayAflScores(fixtures, year);
        // Write back any fixture whose score differs from what's stored — for
        // the fixtures we had authoritative own-round data for. This both lands
        // newly-acquired scores AND self-heals fixtures previously corrupted by
        // the old matchup-only key (e.g. a round-13 fixture left holding a
        // round-5 result): the round-namespaced lookup either overwrites it
        // with the right score or clears it to null until its real game plays.
        const ops = [];
        for (const f of updated) {
          if (!evaluated.has(f.MatchNumber)) continue;
          const orig = fixtures.find(o => o.MatchNumber === f.MatchNumber);
          if (!orig) continue;
          if (orig.HomeTeamScore !== f.HomeTeamScore || orig.AwayTeamScore !== f.AwayTeamScore) {
            ops.push({
              updateOne: {
                filter: { MatchNumber: f.MatchNumber, year },
                update: { $set: { HomeTeamScore: f.HomeTeamScore, AwayTeamScore: f.AwayTeamScore } },
              }
            });
          }
        }
        if (ops.length > 0) {
          await collection.bulkWrite(ops);
          console.log(`Wrote ${ops.length} new scores to MongoDB fixtures`);
        }

        // Kick off player-stats refresh whenever either (a) a fixture's final
        // scores newly land, or (b) any match in the round is currently LIVE.
        // The AFL API omits the score field on LIVE matches, so we can't gate
        // refreshes on "scores landed" alone — that would never fire mid-game
        // and leave live stats stuck empty. Throttled + fire-and-forget.
        if (year === CURRENT_YEAR) {
          const roundsFromOps = ops.map(op => {
            const matchNumber = op.updateOne.filter.MatchNumber;
            const f = updated.find(x => x.MatchNumber === matchNumber);
            return f?.RoundNumber;
          }).filter(r => r !== undefined && r !== null);
          const roundsToRefresh = new Set([...roundsFromOps, ...liveRounds]);
          for (const r of roundsToRefresh) {
            refreshGameResultsForRound(r).catch(() => {});
          }
        }
        fixtures = updated;
      } catch (err) {
        console.warn(`AFL API score refresh failed: ${err.message}`);
      }
    }
  }

  fixtureCache.set(year, { data: fixtures, timestamp: now });
  return fixtures;
}

/**
 * Check if all matches in a round are complete using the AFL API match status.
 * Returns true only when every match has status 'CONCLUDED'.
 * Cached for 2 minutes to avoid hammering the API during live rounds.
 */
export async function isRoundComplete(round, year = CURRENT_YEAR) {
  const cacheKey = `${year}-${round}`;
  const now = Date.now();
  const cached = roundStatusCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < STATUS_CACHE_TTL) {
    return cached.complete;
  }

  try {
    const token = await getAflToken();

    // Detect offset: if round 0 returns no matches, use round+1
    let apiRound = round;
    const { matchCount: c0 } = await fetchAflApiScoresForRound(0, token);
    if (c0 === 0) apiRound = round + 1;

    const res = await fetch(
      `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${apiRound}&pageSize=20`,
      { headers: { 'x-media-mis-token': token }, signal: AbortSignal.timeout(3000) }
    );
    const data = await res.json();
    const matches = data.matches || [];

    if (matches.length === 0) {
      roundStatusCache.set(cacheKey, { complete: false, timestamp: now });
      return false;
    }

    const complete = matches.every(m => m.status === 'CONCLUDED');
    const statuses = [...new Set(matches.map(m => m.status))];
    console.log(`Round ${round} (API round ${apiRound}) statuses: ${statuses.join(', ')} → complete: ${complete}`);

    roundStatusCache.set(cacheKey, { complete, timestamp: now });
    return complete;
  } catch (err) {
    console.error(`Failed to check round ${round} completion:`, err.message);
    // Fall back to checking scores in cached fixture data
    try {
      const fixtures = await getAflFixtures(year);
      const roundFixtures = fixtures.filter(f => f.RoundNumber === round);
      const complete = roundFixtures.length > 0 && roundFixtures.every(
        f => f.HomeTeamScore !== null && f.AwayTeamScore !== null
      );
      roundStatusCache.set(cacheKey, { complete, timestamp: now });
      return complete;
    } catch {
      return false;
    }
  }
}

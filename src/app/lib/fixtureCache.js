// src/app/lib/fixtureCache.js
// Fixture source of truth: MongoDB {year}_fixtures collection.
// On first use, seeds from local JSON file.
// Scores are overlaid from the AFL API for started games and written back to MongoDB.

import { CURRENT_YEAR } from '@/app/lib/constants';
import { connectToDatabase } from '@/app/lib/mongodb';
import { refreshGameResultsForRound, refreshStaleConcludedStats } from '@/app/lib/refreshGameResults';
import path from 'path';
import fs from 'fs/promises';

const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership

// Per-year cache
const fixtureCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Separate cache for round completion status (shorter TTL during live games)
const roundStatusCache = new Map();
const STATUS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Hard wall-clock budget for the AFL score overlay as a whole (on top of the
// per-fetch timeouts) — belt-and-braces against the overlay taking longer than
// expected (e.g. many started rounds) and blocking fixture serving. Distinct
// error type so the caller can tell "timed out" apart from any other overlay
// failure and trip the circuit breaker specifically for that case.
const AFL_OVERLAY_BUDGET_MS = 4000;
class AflOverlayTimeoutError extends Error {}

// Race `promise` against a plain setTimeout, clearing the timer in every exit
// path so it can never keep the lambda alive past the real result landing.
function withTimeout(promise, ms, timeoutError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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

// Short-lived AFL token + round-offset caches, shared across overlayAflScores
// and isRoundComplete so a single page load doesn't re-handshake the token or
// re-probe the offset multiple times. TTL is kept well under STATUS_CACHE_TTL so
// it can never lengthen the effective score-freshness window. Only SUCCESSFUL
// values are cached — a transient failure must never poison these.
const AFL_AUTH_TTL = 90 * 1000;
let cachedToken = null;
let cachedTokenAt = 0;
let cachedOffset = null;
let cachedOffsetAt = 0;

// Circuit breaker for the AFL API. The external aflapi.afl.com.au host can wedge
// (connections hang rather than error/timeout cleanly), and every per-round score
// fetch retrying that timeout in sequence is what turns a single request into a
// 15-20s block that trips Vercel's function timeout. Once we've seen a TOTAL
// failure — the token fetch failed, or every per-round fetch in an overlay pass
// failed — we skip all AFL API work for a cooldown window rather than paying the
// timeout again on the very next request. A PARTIAL success (some rounds landed)
// means the API is actually up, so it clears the latch instead of tripping it.
const AFL_BREAKER_COOLDOWN = 2 * 60 * 1000; // 2 minutes
let aflBreakerTrippedAt = 0;

function isAflBreakerOpen() {
  return aflBreakerTrippedAt > 0 && (Date.now() - aflBreakerTrippedAt) < AFL_BREAKER_COOLDOWN;
}

function tripAflBreaker(reason) {
  aflBreakerTrippedAt = Date.now();
  console.warn(`AFL API circuit breaker tripped (${reason}); skipping AFL API calls for ${AFL_BREAKER_COOLDOWN / 1000}s`);
}

function clearAflBreaker() {
  aflBreakerTrippedAt = 0;
}

async function getAflToken() {
  const now = Date.now();
  if (cachedToken && (now - cachedTokenAt) < AFL_AUTH_TTL) return cachedToken;
  try {
    const res = await fetch('https://api.afl.com.au/cfs/afl/WMCTok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.afl.com.au' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`AFL token HTTP ${res.status}`);
    const { token } = await res.json();
    cachedToken = token;
    cachedTokenAt = now;
    clearAflBreaker();
    return token;
  } catch (err) {
    cachedToken = null;
    cachedTokenAt = 0;
    tripAflBreaker(`token fetch: ${err.message}`);
    throw err;
  }
}

// Detect the AFL round offset (our round 0 = API round 0 or 1). Caches ONLY on a
// successful probe — never the failure default — so a cold-start hiccup can't
// pin a wrong offset for the TTL and blank everyone's scores. Throws on probe
// failure so the caller can fall back to offset=1 WITHOUT caching it.
async function getRoundOffset(token) {
  const now = Date.now();
  if (cachedOffset !== null && (now - cachedOffsetAt) < AFL_AUTH_TTL) return cachedOffset;
  const { matchCount } = await fetchAflApiScoresForRound(0, token); // may throw
  const offset = matchCount === 0 ? 1 : 0;
  cachedOffset = offset;
  cachedOffsetAt = now;
  return offset;
}

// Fetch AFL API matches for a given API round number and return a score map
// keyed by normalised "homeTeam|awayTeam".
async function fetchAflApiScoresForRound(apiRound, token) {
  const res = await fetch(
    `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${apiRound}&pageSize=20`,
    { headers: { 'x-media-mis-token': token }, signal: AbortSignal.timeout(3000) }
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
  // Completion is derived from the RAW match set (before the normalise-drop
  // above) so a name-mapping miss can't flip .every() to a false "complete".
  const complete = matches.length > 0 && matches.every(m => m.status === 'CONCLUDED');
  // A successful call proves the AFL API is reachable — clear any open breaker
  // immediately rather than waiting for the next overlay pass to notice.
  clearAflBreaker();
  return { scoreMap, matchCount: matches.length, complete };
}

// Overlay AFL API scores onto the local fixture array.
// The AFL API may use a different round offset (e.g. Opening Round = 1 not 0).
// We detect the offset by checking which API round returns matches that align
// with our local round 0 fixtures.
async function overlayAflScores(fixtures, year, roundsToFetch = null) {
  const now = Date.now();

  // Only fetch scores for the rounds that actually need them. By default that's
  // every started round, but callers pass the specific rounds with fixtures
  // missing a score — so a mid-season refresh hits one round's AFL endpoint, not
  // all ~15 started rounds (whose scores are already stored).
  const startedRounds = roundsToFetch && roundsToFetch.length > 0
    ? [...new Set(roundsToFetch.map(Number))]
    : [...new Set(
        fixtures
          .filter(f => new Date(f.DateUtc) <= now)
          .map(f => f.RoundNumber)
      )];

  // Every exit path must return the same shape the caller destructures —
  // fixtures unchanged, nothing live, nothing evaluated (so no write-back).
  const unchanged = { fixtures, liveRounds: new Set(), evaluated: new Set() };

  if (startedRounds.length === 0) return unchanged;

  // Circuit breaker: the AFL API host can wedge (connections hang with zero
  // bytes rather than erroring), and paying a 3s timeout per round on every
  // cache-miss request is what turns this into a 504. Once we've seen a total
  // failure, skip AFL work entirely for the cooldown and just serve fixtures
  // as-is — a later successful call (from here or elsewhere) clears the latch.
  if (isAflBreakerOpen()) return unchanged;

  let token;
  try {
    token = await getAflToken();
  } catch (err) {
    console.warn(`AFL API token failed: ${err.message}`);
    return unchanged;
  }

  // Detect round offset (shared cache); fall back to +1 without caching on a
  // transient probe failure.
  let roundOffset;
  try {
    roundOffset = await getRoundOffset(token);
  } catch {
    roundOffset = 1;
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
  // Fetch every round's scores IN PARALLEL rather than sequentially — with the
  // hung AFL API, a sequential `for...await` loop pays the full per-fetch
  // timeout for EACH round in series (5 started rounds × timeout = 15-20s,
  // easily blowing the Vercel function timeout). Promise.allSettled lets all
  // rounds race the same wall-clock window instead of stacking their timeouts.
  const combinedScores = {};
  const liveRounds = new Set();
  const settled = await Promise.allSettled(
    startedRounds.map(localRound =>
      fetchAflApiScoresForRound(localRound + roundOffset, token)
        .then(res => ({ localRound, ...res }))
    )
  );

  let anyRoundSucceeded = false;
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      console.warn(`AFL API scores failed: ${outcome.reason?.message}`);
      continue;
    }
    anyRoundSucceeded = true;
    const { localRound, scoreMap, complete } = outcome.value;
    for (const [matchup, score] of Object.entries(scoreMap)) {
      combinedScores[`${localRound}|${matchup}`] = score;
    }
    if (Object.values(scoreMap).some(s => s.status === 'LIVE')) {
      liveRounds.add(localRound);
    }
    // Warm the completion cache from authoritative match statuses so
    // isRoundComplete (the SOLE gate for star/crab + summary tiles) doesn't
    // have to risk a separate, timeout-prone AFL call. Latch true — a round
    // never un-completes — so a later cross-round pass can't drop the award.
    // (roundStatusCache.set order across rounds doesn't matter — only the
    // never-un-complete latch above does.)
    const ck = `${year}-${localRound}`;
    const prior = roundStatusCache.get(ck);
    if (!(prior && prior.complete)) {
      roundStatusCache.set(ck, { complete, timestamp: now });
    }
  }

  // Only trip the breaker when EVERY round in this pass failed — a partial
  // success means the AFL API is actually up (just maybe slow/flaky for one
  // round), so it would be wrong to blind ourselves to it for 2 minutes.
  if (!anyRoundSucceeded) {
    tripAflBreaker('all per-round score fetches failed');
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

export async function getAflFixtures(year = CURRENT_YEAR, { force = false } = {}) {
  const now = Date.now();
  const cached = fixtureCache.get(year);
  if (!force && cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  // Everything below is the "fresh" path (MongoDB read + AFL overlay). If ANY
  // of it throws — most likely a MongoDB error, since the AFL overlay already
  // swallows its own failures internally — serve the last-good fixtures for
  // this year past their TTL instead of failing the request outright. Stale
  // fixtures beat a 504 or an uncaught error. Note this does NOT change the
  // TTL itself: a healthy fresh fetch still replaces the cache entry as usual.
  try {
    return await fetchFreshFixtures(year, now);
  } catch (err) {
    if (cached) {
      console.warn(
        `getAflFixtures(${year}): fresh fetch failed (${err.message}); ` +
        `serving stale cache from ${new Date(cached.timestamp).toISOString()}`
      );
      return cached.data;
    }
    throw err;
  }
}

async function fetchFreshFixtures(year, now) {
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
        // Only hit the AFL API for the rounds that actually need scoring.
        const roundsNeeded = [...new Set(needsScore.map(f => Number(f.RoundNumber)))];
        // Hard wall-clock budget on the overlay AS A WHOLE, on top of the
        // per-fetch timeouts inside it — if it's not done in time we fall through
        // to the catch below, which serves the un-overlaid `fixtures` unchanged
        // and skips the bulkWrite/refresh block entirely (nothing past this
        // point runs on the timeout path).
        const { fixtures: updated, liveRounds, evaluated } = await withTimeout(
          overlayAflScores(fixtures, year, roundsNeeded),
          AFL_OVERLAY_BUDGET_MS,
          new AflOverlayTimeoutError(`AFL overlay exceeded ${AFL_OVERLAY_BUDGET_MS}ms budget`)
        );
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
        if (err instanceof AflOverlayTimeoutError) {
          tripAflBreaker('overlay exceeded time budget');
        }
      }
    }

    // Stale-stats safety net — runs on every app open (this path is hit by the
    // results page the site lands on), scoped to the current round only. Unlike
    // the score-/live-triggered refresh above, this fires regardless of whether
    // a new score just landed, so a game that concluded with no subsequent
    // (un-throttled) page load still gets its FINAL stats pulled in. "Current
    // round" = the latest round with a game that has started, so it also covers
    // a round's final game once the whole round is done. Internally throttled to
    // 5 min/round; fire-and-forget so it never delays the page.
    const startedRoundNumbers = fixtures
      .filter(f => f.RoundNumber > 0 && new Date(f.DateUtc).getTime() <= now)
      .map(f => f.RoundNumber);
    if (startedRoundNumbers.length > 0) {
      const currentRound = Math.max(...startedRoundNumbers);
      refreshStaleConcludedStats(currentRound).catch(() => {});
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

  // Circuit breaker open — the AFL API is known-down for the cooldown window.
  // Skip straight to the fixture-data fallback instead of paying another
  // timeout on a host we already know is unreachable.
  if (isAflBreakerOpen()) {
    return roundCompleteFromFixtureData(round, year, cacheKey, now);
  }

  try {
    const token = await getAflToken();

    // Reuse the shared offset cache instead of re-probing round 0 every call.
    let offset = 0;
    try {
      offset = await getRoundOffset(token);
    } catch {
      offset = 1;
    }
    const apiRound = round + offset;

    const res = await fetch(
      `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${apiRound}&pageSize=20`,
      { headers: { 'x-media-mis-token': token }, signal: AbortSignal.timeout(3000) }
    );
    const data = await res.json();
    const matches = data.matches || [];
    // A successful call proves the AFL API is reachable — clear any open breaker.
    clearAflBreaker();

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
    return roundCompleteFromFixtureData(round, year, cacheKey, now);
  }
}

// Fallback used both when the AFL API call itself fails and when the circuit
// breaker is already open: derive round completion from whatever scores are
// currently stored in the (possibly stale) fixture data instead of the AFL API.
async function roundCompleteFromFixtureData(round, year, cacheKey, now) {
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

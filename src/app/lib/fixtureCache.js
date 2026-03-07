// src/app/lib/fixtureCache.js
// Fixture source of truth: MongoDB {year}_fixtures collection.
// On first use, seeds from local JSON file.
// Scores are overlaid from the AFL API for started games and written back to MongoDB.

import { CURRENT_YEAR } from '@/app/lib/constants';
import { connectToDatabase } from '@/app/lib/mongodb';
import path from 'path';
import fs from 'fs/promises';

const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership

// Per-year cache
const fixtureCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Separate cache for round completion status (shorter TTL during live games)
const roundStatusCache = new Map();
const STATUS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Normalise team names for fuzzy matching between local file and AFL API
function normaliseTeam(name = '') {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('suns', 'goldcoast')
    .replace('giants', 'gws')
    .replace('swans', 'sydney')
    .replace('lions', 'brisbane')
    .replace('eagles', 'westcoast')
    .replace('bulldogs', 'westernbulldogs')
    .replace('kangaroos', 'northmelbourne');
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
    const homeNorm = normaliseTeam(m.home?.team?.name);
    const awayNorm = normaliseTeam(m.away?.team?.name);
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

  // Build a combined score map across all started rounds
  const combinedScores = {};
  for (const localRound of startedRounds) {
    const apiRound = localRound + roundOffset;
    try {
      const { scoreMap } = await fetchAflApiScoresForRound(apiRound, token);
      Object.assign(combinedScores, scoreMap);
    } catch (err) {
      console.warn(`AFL API scores failed for round ${apiRound}: ${err.message}`);
    }
  }

  // Apply scores to matching fixtures
  let updated = 0;
  const result = fixtures.map(f => {
    const key = `${normaliseTeam(f.HomeTeam)}|${normaliseTeam(f.AwayTeam)}`;
    const score = combinedScores[key];
    if (!score) return f;
    if (score.homeScore === null && score.awayScore === null) return f;
    updated++;
    return {
      ...f,
      HomeTeamScore: score.homeScore,
      AwayTeamScore: score.awayScore,
    };
  });

  console.log(`AFL API: overlaid scores on ${updated}/${fixtures.length} fixtures`);
  return result;
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
    const needsScore = fixtures.filter(
      f => new Date(f.DateUtc) <= now &&
           (f.HomeTeamScore === null || f.AwayTeamScore === null)
    );

    if (needsScore.length > 0) {
      try {
        const updated = await overlayAflScores(fixtures, year);
        // Write any newly-acquired scores back to MongoDB
        const ops = [];
        for (const f of updated) {
          if (f.HomeTeamScore !== null && f.AwayTeamScore !== null) {
            const orig = fixtures.find(o => o.MatchNumber === f.MatchNumber);
            if (!orig || orig.HomeTeamScore === null || orig.AwayTeamScore === null) {
              ops.push({
                updateOne: {
                  filter: { MatchNumber: f.MatchNumber, year },
                  update: { $set: { HomeTeamScore: f.HomeTeamScore, AwayTeamScore: f.AwayTeamScore } },
                }
              });
            }
          }
        }
        if (ops.length > 0) {
          await collection.bulkWrite(ops);
          console.log(`Wrote ${ops.length} new scores to MongoDB fixtures`);
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

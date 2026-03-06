// src/app/lib/fixtureCache.js
// In-memory cache for AFL fixtures JSON
// Uses local file for fixture structure; overlays live scores from the AFL API.

import { CURRENT_YEAR } from '@/app/lib/constants';
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

  // Load fixture structure from local file (reliable, pre-populated)
  const fixturesPath = path.join(process.cwd(), 'public', `afl-${year}.json`);
  let fixtures;
  try {
    const raw = await fs.readFile(fixturesPath, 'utf8');
    fixtures = JSON.parse(raw);
    console.log(`Fixtures for ${year} loaded from local file`);
  } catch {
    throw new Error(`No local fixture file for ${year}`);
  }

  // Overlay live scores from AFL API (only for current year)
  if (year === CURRENT_YEAR) {
    try {
      fixtures = await overlayAflScores(fixtures, year);
    } catch (err) {
      console.warn(`AFL API score overlay failed: ${err.message}`);
      // Try fixturedownload.com as fallback for scores
      try {
        const res = await fetch(`https://fixturedownload.com/feed/json/afl-${year}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          const minRound = Math.min(...data.map(m => m.RoundNumber));
          const round1Count = data.filter(m => m.RoundNumber === 1).length;
          const normalized = (minRound === 1 && round1Count <= 6)
            ? data.map(m => ({ ...m, RoundNumber: m.RoundNumber - 1 }))
            : data;
          // Merge scores into local fixtures by match number
          const scoreByMatch = {};
          normalized.forEach(m => { scoreByMatch[m.MatchNumber] = m; });
          fixtures = fixtures.map(f => {
            const s = scoreByMatch[f.MatchNumber];
            if (!s) return f;
            return { ...f, HomeTeamScore: s.HomeTeamScore, AwayTeamScore: s.AwayTeamScore };
          });
          console.log(`Scores overlaid from fixturedownload.com (fallback)`);
        }
      } catch {
        console.warn(`fixturedownload.com fallback also failed`);
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

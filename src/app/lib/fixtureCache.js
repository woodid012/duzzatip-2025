// src/app/lib/fixtureCache.js
// In-memory cache for AFL fixtures JSON
// Prefers external API (has live scores) with local file as fallback

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

export async function getAflFixtures(year = CURRENT_YEAR) {
  const now = Date.now();
  const cached = fixtureCache.get(year);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  // Try external API first — it includes scores for completed matches
  try {
    const response = await fetch(`https://fixturedownload.com/feed/json/afl-${year}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    fixtureCache.set(year, { data, timestamp: now });
    console.log(`Fixtures for ${year} loaded from external API (cache refreshed)`);
    return data;
  } catch (err) {
    console.log(`External API failed for ${year} fixtures (${err.message}), falling back to local file`);
  }

  // Fall back to local file (no scores, but has structure/dates)
  const fixturesPath = path.join(process.cwd(), 'public', `afl-${year}.json`);
  try {
    const fixturesData = await fs.readFile(fixturesPath, 'utf8');
    const parsed = JSON.parse(fixturesData);
    fixtureCache.set(year, { data: parsed, timestamp: now });
    console.log(`Fixtures for ${year} loaded from local file (cache refreshed)`);
    return parsed;
  } catch {
    throw new Error(`No fixtures available for ${year} (API and local file both failed)`);
  }
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
    // Get AFL API token
    const tokenRes = await fetch('https://api.afl.com.au/cfs/afl/WMCTok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.afl.com.au' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    const { token } = await tokenRes.json();

    // Fetch match statuses for the round
    const matchesRes = await fetch(
      `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${round}&pageSize=20`,
      { headers: { 'x-media-mis-token': token }, signal: AbortSignal.timeout(10000) }
    );
    const data = await matchesRes.json();
    const matches = data.matches || [];

    if (matches.length === 0) {
      roundStatusCache.set(cacheKey, { complete: false, timestamp: now });
      return false;
    }

    const complete = matches.every(m => m.status === 'CONCLUDED');
    const statuses = [...new Set(matches.map(m => m.status))];
    console.log(`Round ${round} match statuses: ${statuses.join(', ')} → complete: ${complete}`);

    roundStatusCache.set(cacheKey, { complete, timestamp: now });
    return complete;
  } catch (err) {
    console.error(`Failed to check round ${round} completion:`, err.message);
    // On failure, fall back to fixturedownload.com scores if available
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

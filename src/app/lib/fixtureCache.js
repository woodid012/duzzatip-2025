// src/app/lib/fixtureCache.js
// In-memory cache for AFL fixtures JSON to avoid repeated disk reads

import { CURRENT_YEAR } from '@/app/lib/constants';
import path from 'path';
import fs from 'fs/promises';

// Per-year cache
const fixtureCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getAflFixtures(year = CURRENT_YEAR) {
  const now = Date.now();
  const cached = fixtureCache.get(year);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  // Try local file first (works for any year with a local JSON)
  const fixturesPath = path.join(process.cwd(), 'public', `afl-${year}.json`);
  try {
    const fixturesData = await fs.readFile(fixturesPath, 'utf8');
    const parsed = JSON.parse(fixturesData);
    fixtureCache.set(year, { data: parsed, timestamp: now });
    console.log(`Fixtures for ${year} loaded from local file (cache refreshed)`);
    return parsed;
  } catch {
    // Local file not found, fall back to external API
    console.log(`No local fixtures file for ${year}, fetching from external API`);
    const response = await fetch(`https://fixturedownload.com/feed/json/afl-${year}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${year} fixtures: ${response.status}`);
    }
    const data = await response.json();
    fixtureCache.set(year, { data, timestamp: now });
    console.log(`Fixtures for ${year} loaded from external API (cache refreshed)`);
    return data;
  }
}

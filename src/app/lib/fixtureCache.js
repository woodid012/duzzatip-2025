// src/app/lib/fixtureCache.js
// In-memory cache for AFL fixtures JSON to avoid repeated disk reads

import { CURRENT_YEAR } from '@/app/lib/constants';
import path from 'path';
import fs from 'fs/promises';

let cachedFixtures = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getAflFixtures() {
  const now = Date.now();
  if (cachedFixtures && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedFixtures;
  }

  const fixturesPath = path.join(process.cwd(), 'public', `afl-${CURRENT_YEAR}.json`);
  const fixturesData = await fs.readFile(fixturesPath, 'utf8');
  cachedFixtures = JSON.parse(fixturesData);
  cacheTimestamp = now;
  console.log('Fixtures loaded from disk (cache refreshed)');
  return cachedFixtures;
}

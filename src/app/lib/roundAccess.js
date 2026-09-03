// src/app/lib/roundAccess.js
// Server-side round visibility helpers for the "mine until lockout, then all"
// privacy rule and the public live/last-round view.
import { CURRENT_YEAR } from '@/app/lib/constants';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import {
  isRoundFullyLocked,
  startedMatchNumbers as startedMatchNumbersFor,
} from '@/app/lib/rollingLockout';

// A round is "locked" once its first scheduled game has started — at that point
// teams/tips are committed and everyone's become visible. Before lockout, only
// the owner (and admin) may see a given player's team/tips.
export async function isRoundLocked(round, year = CURRENT_YEAR) {
  const r = Number(round);
  if (!Number.isFinite(r)) return false;
  // Opening round (0) and finals: treat as locked (historical / no pre-lockout
  // secrecy needed by the time anyone's viewing them via the gated APIs).
  try {
    const fixtures = await getAflFixtures(year);
    const roundFixtures = fixtures.filter((f) => Number(f.RoundNumber) === r);
    if (roundFixtures.length === 0) return true; // nothing to protect
    const firstStart = Math.min(...roundFixtures.map((f) => new Date(f.DateUtc).getTime()));
    return Date.now() >= firstStart;
  } catch {
    // Fail safe: if we can't determine lockout, treat as NOT locked so we don't
    // accidentally leak pre-lockout selections.
    return false;
  }
}

// Rolling lockout: the MatchNumbers in a round whose game has already
// commenced. Those matches' tips are committed — locked to their owner, and
// visible to everyone else. Anything not in this set is still in play, so it
// stays both editable and private.
//
// Fails CLOSED for visibility purposes: if we can't read the fixtures we return
// an empty set, so nothing is revealed and nothing is treated as committed.
export async function startedMatchNumbers(round, year = CURRENT_YEAR) {
  const r = Number(round);
  if (!Number.isFinite(r)) return new Set();
  try {
    const fixtures = await getAflFixtures(year);
    return startedMatchNumbersFor(fixtures, r);
  } catch {
    return new Set();
  }
}

// True once EVERY game in the round has started — the point at which a round is
// finished with, rather than merely underway.
export async function isRoundFullyStarted(round, year = CURRENT_YEAR) {
  const r = Number(round);
  if (!Number.isFinite(r)) return false;
  try {
    const fixtures = await getAflFixtures(year);
    return isRoundFullyLocked(fixtures, r);
  } catch {
    return false;
  }
}

// The round a public (not-logged-in) visitor may see: the live round if one is
// in progress, otherwise the most recently started round. Falls back to 0.
export async function publicRound(year = CURRENT_YEAR) {
  try {
    const fixtures = await getAflFixtures(year);
    const now = Date.now();
    const started = fixtures.filter((f) => new Date(f.DateUtc).getTime() <= now);
    if (started.length === 0) return 0;
    return Math.max(...started.map((f) => Number(f.RoundNumber)));
  } catch {
    return 0;
  }
}

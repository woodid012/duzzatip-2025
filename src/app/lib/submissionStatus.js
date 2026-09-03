// src/app/lib/submissionStatus.js
//
// Who got their picks in before the first bounce.
//
// This one fact drives both halves of the round rules:
//   • Lockout — a submitter is locked firmly at the first bounce; only someone
//     who missed the deadline gets the rolling, game-by-game window.
//   • Visibility — a submitter sees everyone else's teams/tips from the first
//     bounce; someone still entering picks sees nobody's, or the concession
//     would be a licence to copy.
//
// "Submitted" means a row exists for the round that was last written BEFORE the
// first bounce. That test holds up on its own: a submitter can't write again
// after the bounce (they're firmly locked), and a non-submitter's later saves
// all carry post-bounce timestamps, so they never look like an on-time entry.

import { CURRENT_YEAR } from '@/app/lib/constants';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { firstGameStart, isRoundFullyLocked } from '@/app/lib/rollingLockout';

// Team and tips are gated separately and deliberately. Submitting a team must
// not unlock other people's TIPS while your own tips are still open — that
// would hand you the exact picks you're about to make.
const SOURCES = {
  team: { collection: 'team_selection', user: 'User', updated: 'Last_Updated' },
  tips: { collection: 'tips', user: 'User', updated: 'LastUpdated' },
};

/**
 * The set of user ids who had a `kind` ("team" | "tips") saved for this round
 * before its first game started.
 *
 * Returns an empty set when the round hasn't started or has no fixtures —
 * before the bounce nobody is locked and nobody may see anyone else, so
 * "nobody has submitted yet" is the right answer for both callers.
 */
export async function submittedOnTimeIds(db, kind, round, year = CURRENT_YEAR) {
  const src = SOURCES[kind];
  if (!src) throw new Error(`Unknown submission kind: ${kind}`);

  const r = Number(round);
  if (!Number.isFinite(r)) return new Set();

  let firstBounce;
  try {
    const fixtures = await getAflFixtures(year);
    firstBounce = firstGameStart(fixtures, r);
  } catch {
    // Can't establish the deadline, so nobody counts as a submitter. For the
    // read path that's fail-closed — no picks are released. The write path never
    // reaches a wrong answer here: the routes load fixtures themselves first and
    // fail the request outright if that's what's broken.
    return new Set();
  }
  if (!firstBounce || Date.now() < firstBounce.getTime()) return new Set();

  const rows = await db
    .collection(`${year}_${src.collection}`)
    .find(
      { Round: r, Active: 1, [src.updated]: { $lt: firstBounce } },
      { projection: { [src.user]: 1 } }
    )
    .toArray();

  return new Set(rows.map((row) => Number(row[src.user])));
}

/** Did this one user submit `kind` before the first bounce? */
export async function didSubmitOnTime(db, kind, round, userId, year = CURRENT_YEAR) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return false;
  const ids = await submittedOnTimeIds(db, kind, round, year);
  return ids.has(uid);
}

/**
 * May this viewer see other players' `kind` for this round?
 *
 * Yes for admin. Yes for a player who submitted before the bounce. And yes for
 * everyone once every game in the round has started — at that point nobody can
 * enter anything, so there's nothing left to protect, and withholding would
 * just break history: past rounds, the ladder, and the server-to-server calls
 * that rebuild it (which carry no session at all).
 *
 * Otherwise no — including for visitors who aren't logged in. That last part is
 * load-bearing rather than incidental: leaving the public view open would let
 * any player read the whole competition from a logged-out tab, and the rule
 * would mean nothing.
 */
export async function canSeeOthers(db, kind, round, { isAdmin, viewerId }, year = CURRENT_YEAR) {
  if (isAdmin) return true;

  const r = Number(round);
  if (Number.isFinite(r)) {
    try {
      const fixtures = await getAflFixtures(year);
      if (isRoundFullyLocked(fixtures, r)) return true;
    } catch {
      // Fall through to the submission test — fail closed.
    }
  }

  if (viewerId === null || viewerId === undefined) return false;
  return didSubmitOnTime(db, kind, round, viewerId, year);
}

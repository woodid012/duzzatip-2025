import { createApiHandler, parseYearParam, createSuccessResponse, withReadCache } from '@/app/lib/apiUtils';
import { syncFinalsFixtures } from '@/app/lib/duzzaFinalsFixtures';
import { connectToFinalsDatabase } from '@/app/lib/mongodb';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import { getFinalsSessionEntrant } from '@/app/lib/duzzaFinalsAuth';
import { isRoundLocked } from '@/app/lib/roundAccess';
import { getAflFixtures, isRoundComplete } from '@/app/lib/fixtureCache';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { refreshGameResultsForRound, refreshStaleConcludedStats } from '@/app/lib/refreshGameResults';
import { getShared, setShared } from '@/app/lib/sharedCache';
import {
  DUZZA_FINALS_ROUNDS,
  DUZZA_FINALS_WEEK_LABELS,
  isDuzzaFinalsRound,
  getPlayerPoolForRound,
  computeWeeklyScores,
  computeBracket,
  seedEntrants,
} from '@/app/lib/duzzaFinals';

// The bracket is the same for everyone (only ?detail=1 is privacy-filtered),
// it's polled once a minute by every open tab, and recomputing it is the
// dashboard's main cost — so one instance's computation stands in for all of
// them for a few seconds. Short enough that a live week's scores still move at
// the poll's pace; long enough that a crowd watching the same week costs one
// computation between them. The Refresh button bypasses it.
const BRACKET_SNAPSHOT_TTL = 20 * 1000;

// Browser-side caching for the same reason, one step closer to the user. Ten
// seconds is under the client's one-minute poll, so a poll still reaches the
// network while a navigation back to the page paints instantly.
const READ_CACHE_SECONDS = 10;

function invalidRoundResponse() {
  return Response.json(
    { error: `Round must be one of: ${DUZZA_FINALS_ROUNDS.join(', ')}` },
    { status: 400 }
  );
}

// The caller's own entrant id, from EITHER the main-app session (a core
// team, or admin which always sees everything) OR a Duzza Finals session
// cookie (an invited entrant). Returns { isAdmin, ownId }.
function resolveViewer(request) {
  const mainSess = getSessionUser(request);
  if (mainSess) {
    return mainSess.uid === ADMIN_UID
      ? { isAdmin: true, ownId: null }
      : { isAdmin: false, ownId: Number(mainSess.uid) };
  }
  const finalsSess = getFinalsSessionEntrant(request);
  if (finalsSess) {
    return { isAdmin: false, ownId: Number(finalsSess.entrantId) };
  }
  return { isAdmin: false, ownId: null };
}

// GET ?round=26&detail=1 — position-by-position "your team" + "around the
// grounds" detail for a single round, covering ALL entrants (core +
// invited) who have an entry that week. Privacy: only available for a round
// once it's locked (isRoundLocked), EXCEPT the caller's own entry, which is
// always visible pre-lockout too — mirrors the entry route's privacy rule.
// An unauthenticated caller pre-lockout gets entrantDetails: [].
// The core entrants are upserted once per instance: the upsert is a no-op
// after the first time and this runs on every detail poll.
const seededYears = new Set();
async function seedEntrantsOnce(finalsDb, year) {
  if (seededYears.has(year)) return;
  await seedEntrants(finalsDb, year);
  seededYears.add(year);
}

async function getRoundDetail(request, seasonDb, finalsDb, round, year, { forceFresh = false } = {}) {
  const label = DUZZA_FINALS_WEEK_LABELS[round];
  const [pool, locked] = await Promise.all([
    getPlayerPoolForRound(seasonDb, round, year),
    isRoundLocked(round, year),
    seedEntrantsOnce(finalsDb, year),
  ]);
  const fixturesKnown = pool.fixturesKnown;
  const roundComplete = fixturesKnown ? await isRoundComplete(round, year).catch(() => false) : false;

  const entrants = await finalsDb.collection(`${year}_entrants`).find({}).toArray();
  const nameById = {};
  const sourceById = {};
  for (const e of entrants) {
    const id = Number(e.EntrantId);
    nameById[id] = e.Name;
    sourceById[id] = e.Source === 'invited' ? 'invited' : 'core';
  }

  const entryDocs = await finalsDb
    .collection(`${year}_entries`)
    .find({ Round: round }, { projection: { Entrant: 1, _id: 0 } })
    .toArray();
  const enteredIds = entryDocs.map((d) => Number(d.Entrant));

  const { isAdmin, ownId } = resolveViewer(request);

  let visibleIds;
  if (isAdmin || locked) {
    visibleIds = enteredIds;
  } else if (ownId !== null) {
    visibleIds = enteredIds.filter((id) => id === ownId);
  } else {
    visibleIds = [];
  }

  let entrantDetails = [];
  if (fixturesKnown && visibleIds.length > 0) {
    // Same idea as the bracket snapshot below: once a week is locked every
    // viewer sees the same set, so one instance's scoring stands in for all
    // of them for a few seconds. The key carries the visible set, so a
    // pre-lockout viewer never reads another viewer's filtered answer.
    const scoresKey = `duzza-finals-detail:${year}:${round}:${[...visibleIds].sort((a, b) => a - b).join(',')}`;
    let scores = forceFresh ? undefined : await getShared(scoresKey);
    if (scores === undefined) {
      scores = await computeWeeklyScores(seasonDb, finalsDb, round, year, visibleIds, { detail: true });
      await setShared(scoresKey, scores, BRACKET_SNAPSHOT_TTL);
    }
    entrantDetails = scores.map((s) => ({
      userId: s.userId,
      name: nameById[s.userId] || null,
      source: sourceById[s.userId] || null,
      positionScores: s.positionScores,
      benchAndReserves: s.benchAndReserves,
      tips: s.tips,
      playerScore: s.playerScore,
      deadCertScore: s.deadCertScore,
      totalScore: s.totalScore,
      correctTips: s.correctTips,
    }));
  }

  return createSuccessResponse({ round, label, fixturesKnown, roundComplete, locked, entrantDetails });
}

// No privacy filtering on the bracket itself (?round&detail=1
// aside, see getRoundDetail above). Re-derives everything live from the
// entries in duzza_finals + season data (fixtures/players/game_results), so
// there's no snapshot to go stale.
export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const year = parseYearParam(searchParams);
  const roundParam = searchParams.get('round');
  const detailParam = searchParams.get('detail');
  const round = roundParam !== null && detailParam ? Number(roundParam) : null;

  if (round !== null && (!Number.isInteger(round) || !isDuzzaFinalsRound(round))) {
    return invalidRoundResponse();
  }

  // Finals fixtures never arrive via the season pipeline (it only updates
  // existing rows) — pull/refresh them here, throttled internally. Not
  // awaited: the request that lands as the throttle expires shouldn't pay
  // for the AFL round trips, the same way fixtureCache runs its refreshes.
  syncFinalsFixtures(db, year).catch(() => {});

  if (round !== null && searchParams.get('refresh') === '1' && year === CURRENT_YEAR) {
    // Match the in-season Refresh button: await fresh stats before reading
    // scores, including finished games that still have a live snapshot.
    try {
      await refreshGameResultsForRound(round, { force: true, liveOnly: true });
    } catch (error) {
      console.warn(`Forced finals game_results refresh failed for round ${round}: ${error.message}`);
    }
    try {
      await refreshStaleConcludedStats(round, { force: true });
    } catch (error) {
      console.warn(`Forced finals stale-stats refresh failed for round ${round}: ${error.message}`);
    }
    await getAflFixtures(year, { force: true });
  }

  const finalsDb = await connectToFinalsDatabase();

  const forceFresh = searchParams.get('refresh') === '1';

  if (round !== null) {
    return withReadCache(await getRoundDetail(request, db, finalsDb, round, year, { forceFresh }), READ_CACHE_SECONDS);
  }

  const snapshotKey = `duzza-finals-bracket:${year}`;

  let bracket = forceFresh ? undefined : await getShared(snapshotKey);
  if (bracket === undefined) {
    // Refresh also re-derives weeks the bracket has already frozen — the one
    // way a decided week's numbers can change.
    bracket = await computeBracket(db, finalsDb, year, { recompute: forceFresh });
    await setShared(snapshotKey, bracket, BRACKET_SNAPSHOT_TTL);
  }

  return withReadCache(createSuccessResponse({ year, ...bracket }), READ_CACHE_SECONDS);
});

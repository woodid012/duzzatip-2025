import { createApiHandler, parseYearParam, createSuccessResponse } from '@/app/lib/apiUtils';
import { syncFinalsFixtures } from '@/app/lib/duzzaFinalsFixtures';
import { connectToFinalsDatabase } from '@/app/lib/mongodb';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import { getFinalsSessionEntrant } from '@/app/lib/duzzaFinalsAuth';
import { isRoundLocked } from '@/app/lib/roundAccess';
import { getAflFixtures, isRoundComplete } from '@/app/lib/fixtureCache';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { refreshGameResultsForRound, refreshStaleConcludedStats } from '@/app/lib/refreshGameResults';
import {
  DUZZA_FINALS_ROUNDS,
  DUZZA_FINALS_WEEK_LABELS,
  isDuzzaFinalsRound,
  getPlayerPoolForRound,
  computeWeeklyScores,
  computeBracket,
  seedEntrants,
} from '@/app/lib/duzzaFinals';

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
async function getRoundDetail(request, seasonDb, finalsDb, round, year) {
  const label = DUZZA_FINALS_WEEK_LABELS[round];
  const pool = await getPlayerPoolForRound(seasonDb, round, year);
  const fixturesKnown = pool.fixturesKnown;
  const roundComplete = fixturesKnown ? await isRoundComplete(round, year).catch(() => false) : false;
  const locked = await isRoundLocked(round, year);

  await seedEntrants(finalsDb, year);

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
    const scores = await computeWeeklyScores(seasonDb, finalsDb, round, year, visibleIds, { detail: true });
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
  // existing rows) — pull/refresh them here, throttled internally.
  await syncFinalsFixtures(db, year);

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

  if (round !== null) {
    return await getRoundDetail(request, db, finalsDb, round, year);
  }

  const bracket = await computeBracket(db, finalsDb, year);

  return createSuccessResponse({ year, ...bracket });
});

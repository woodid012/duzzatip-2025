import { createApiHandler, parseYearParam, createSuccessResponse, withReadCache } from '@/app/lib/apiUtils';
import { DUZZA_FINALS_ROUNDS, isDuzzaFinalsRound, getPlayerPoolForRound } from '@/app/lib/duzzaFinals';
import { syncFinalsFixtures } from '@/app/lib/duzzaFinalsFixtures';

export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const year = parseYearParam(searchParams);
  const roundParam = searchParams.get('round');

  if (roundParam === null || roundParam === undefined) {
    return Response.json({ error: 'Round parameter is required' }, { status: 400 });
  }

  const round = parseInt(roundParam, 10);
  if (isNaN(round) || !isDuzzaFinalsRound(round)) {
    return Response.json(
      { error: `Round must be one of: ${DUZZA_FINALS_ROUNDS.join(', ')}` },
      { status: 400 }
    );
  }

  // Finals fixtures never arrive via the season pipeline (it only updates
  // existing rows) — pull/refresh them here, throttled internally. Not
  // awaited: the request that lands as the throttle expires shouldn't pay
  // for the AFL round trips, the same way fixtureCache runs its refreshes.
  syncFinalsFixtures(db, year).catch(() => {});

  const pool = await getPlayerPoolForRound(db, round, year);

  // The week's player pool only changes when the AFL publishes the next
  // week's fixtures, so a couple of minutes in the browser costs nothing.
  return withReadCache(
    createSuccessResponse({
      round,
      year,
      fixturesKnown: pool.fixturesKnown,
      teamsPlaying: pool.teamsPlaying,
      playersByTeam: pool.playersByTeam,
    }),
    120
  );
});

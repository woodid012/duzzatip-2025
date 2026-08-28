import { createApiHandler, parseYearParam, createSuccessResponse } from '@/app/lib/apiUtils';
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
  // existing rows) — pull/refresh them here, throttled internally.
  await syncFinalsFixtures(db, year);

  const pool = await getPlayerPoolForRound(db, round, year);

  return createSuccessResponse({
    round,
    year,
    fixturesKnown: pool.fixturesKnown,
    teamsPlaying: pool.teamsPlaying,
    playersByTeam: pool.playersByTeam,
  });
});

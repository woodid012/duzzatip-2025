import { createApiHandler, getCollectionForYear, parseYearParam } from '../../lib/apiUtils';

// Cache finals results for faster fixture calculation
export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const round = parseInt(searchParams.get('round'));
  const year = parseYearParam(searchParams);

  if (!round || round < 22) {
    return Response.json({ error: 'Round must be 22 or higher for finals' }, { status: 400 });
  }

  try {
    // Get cached finals result for this round
    const cachedResult = await getCollectionForYear(db, 'finals_cache', year)
      .findOne({ round: round, year: year });

    if (cachedResult) {
      console.log(`Found cached finals result for round ${round} (year ${year})`);
      return Response.json({
        round,
        cached: true,
        results: cachedResult.results,
        fixtures: cachedResult.fixtures,
        winners: cachedResult.winners,
        cachedAt: cachedResult.cachedAt
      });
    }

    return Response.json({
      round,
      cached: false,
      message: 'No cached results found for this round'
    });

  } catch (error) {
    console.error('Finals cache error:', error);
    throw error;
  }
});

import { createApiHandler, getCollection } from '../../lib/apiUtils';
import { CURRENT_YEAR } from '@/app/lib/constants';

// Cache finals results for faster fixture calculation
export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const round = parseInt(searchParams.get('round'));
  
  if (!round || round < 22) {
    return Response.json({ error: 'Round must be 22 or higher for finals' }, { status: 400 });
  }

  try {
    // Get cached finals result for this round
    const cachedResult = await getCollection(db, 'finals_cache')
      .findOne({ round: round, year: CURRENT_YEAR });

    if (cachedResult) {
      console.log(`Found cached finals result for round ${round}`);
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

export const POST = createApiHandler(async (request, db) => {
  const body = await request.json();
  const { round, results, fixtures, winners } = body;
  
  if (!round || round < 22) {
    return Response.json({ error: 'Round must be 22 or higher for finals' }, { status: 400 });
  }

  if (!results || !fixtures) {
    return Response.json({ error: 'Results and fixtures are required' }, { status: 400 });
  }

  try {
    const finalsCache = getCollection(db, 'finals_cache');
    
    // Upsert the cached finals result
    await finalsCache.updateOne(
      { round: round, year: CURRENT_YEAR },
      {
        $set: {
          round,
          year: CURRENT_YEAR,
          results,
          fixtures,
          winners,
          cachedAt: new Date(),
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log(`Cached finals results for round ${round}`);

    return Response.json({
      success: true,
      round,
      message: `Finals results cached for round ${round}`
    });

  } catch (error) {
    console.error('Error caching finals results:', error);
    throw error;
  }
});
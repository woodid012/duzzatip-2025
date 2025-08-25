import { createApiHandler, getCollection } from '../../lib/apiUtils';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

// Cache tipping ladder calculations for faster loading
export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const upToRound = parseInt(searchParams.get('upToRound')) || 24;
  
  try {
    // Get cached tipping ladder for this round range
    const cachedLadder = await getCollection(db, 'tipping_ladder_cache')
      .findOne({ 
        upToRound: upToRound, 
        year: CURRENT_YEAR 
      });

    if (cachedLadder) {
      console.log(`Found cached tipping ladder up to round ${upToRound}`);
      return Response.json({
        upToRound,
        cached: true,
        ladder: cachedLadder.ladder,
        roundResults: cachedLadder.roundResults || {},
        cachedAt: cachedLadder.cachedAt,
        lastUpdated: cachedLadder.lastUpdated
      });
    }

    return Response.json({
      upToRound,
      cached: false,
      message: 'No cached ladder found'
    });

  } catch (error) {
    console.error('Tipping ladder cache error:', error);
    throw error;
  }
});

export const POST = createApiHandler(async (request, db) => {
  const body = await request.json();
  const { upToRound, ladder, roundResults } = body;
  
  if (!upToRound || !ladder) {
    return Response.json({ error: 'upToRound and ladder are required' }, { status: 400 });
  }

  try {
    const tippingLadderCache = getCollection(db, 'tipping_ladder_cache');
    
    // Upsert the cached ladder
    await tippingLadderCache.updateOne(
      { upToRound: upToRound, year: CURRENT_YEAR },
      {
        $set: {
          upToRound,
          year: CURRENT_YEAR,
          ladder,
          roundResults: roundResults || {},
          cachedAt: new Date(),
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );

    console.log(`Cached tipping ladder up to round ${upToRound}`);

    return Response.json({
      success: true,
      upToRound,
      message: `Tipping ladder cached up to round ${upToRound}`
    });

  } catch (error) {
    console.error('Error caching tipping ladder:', error);
    throw error;
  }
});

// DELETE endpoint to clear cache when tipping data changes
export const DELETE = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const fromRound = parseInt(searchParams.get('fromRound'));
  
  try {
    const tippingLadderCache = getCollection(db, 'tipping_ladder_cache');
    
    if (fromRound) {
      // Clear cache for rounds >= fromRound (when a specific round's tips change)
      await tippingLadderCache.deleteMany({
        year: CURRENT_YEAR,
        upToRound: { $gte: fromRound }
      });
      console.log(`Cleared tipping ladder cache from round ${fromRound} onwards`);
    } else {
      // Clear all cache for this year
      await tippingLadderCache.deleteMany({ year: CURRENT_YEAR });
      console.log(`Cleared all tipping ladder cache for year ${CURRENT_YEAR}`);
    }

    return Response.json({
      success: true,
      message: fromRound ? 
        `Cache cleared from round ${fromRound} onwards` : 
        `All tipping ladder cache cleared`
    });

  } catch (error) {
    console.error('Error clearing tipping ladder cache:', error);
    throw error;
  }
});
import { promises as fs } from 'fs';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { parseYearParam, blockWritesForPastYear } from '@/app/lib/apiUtils';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseYearParam(searchParams);

    // Get fixtures (cached in memory for current year, fetched from API for past years)
    let fixtures;
    try {
      if (year !== CURRENT_YEAR) {
        const response = await fetch(`https://fixturedownload.com/feed/json/afl-${year}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${year} fixtures: ${response.status}`);
        }
        fixtures = await response.json();
      } else {
        fixtures = await getAflFixtures();
      }
    } catch (fileError) {
      console.warn('Static fixtures file not found, fetching from API');

      // Fallback to API if file doesn't exist
      const response = await fetch(`https://fixturedownload.com/feed/json/afl-${year}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch fixtures: ${response.status}`);
      }
      fixtures = await response.json();

      // Try to save for next time (only for current year)
      if (year === CURRENT_YEAR) {
        try {
          await fs.mkdir(join(process.cwd(), 'public'), { recursive: true });
          await fs.writeFile(fixturesPath, JSON.stringify(fixtures, null, 2));
          console.log('Fixtures saved to static file');
        } catch (saveError) {
          console.warn('Failed to save fixtures to static file:', saveError);
        }
      }
    }

    // Get round from query params
    const round = searchParams.get('round');
    const userId = searchParams.get('userId');

    // If we have a round and userId, fetch tips from database
    if (round && userId) {
      const { db } = await connectToDatabase();
      const tipsCollection = db.collection(`${year}_tips`);
      const tips = await tipsCollection
        .find({
          Round: parseInt(round),
          User: parseInt(userId),
          Active: 1
        }).toArray();

      // Get last updated time
      const lastUpdate = await tipsCollection
        .find({
          Round: parseInt(round),
          User: parseInt(userId),
          Active: 1
        })
        .sort({ LastUpdated: -1 })
        .limit(1)
        .toArray();
        
      const lastUpdated = lastUpdate.length > 0 ? lastUpdate[0].LastUpdated : null;

      // Get fixtures for this round
      const roundFixtures = fixtures.filter(f => f.RoundNumber.toString() === round);
      
      // Build tips object including default Home Team selections for missing tips
      const tipsWithDefaults = {};
      roundFixtures.forEach(fixture => {
        const existingTip = tips.find(t => t.MatchNumber === fixture.MatchNumber);
        
        if (existingTip) {
          tipsWithDefaults[fixture.MatchNumber] = {
            team: existingTip.Team,
            deadCert: existingTip.DeadCert
          };
        } else {
          // Default to home team if no tip exists
          tipsWithDefaults[fixture.MatchNumber] = {
            team: fixture.HomeTeam,
            deadCert: false,
            isDefault: true
          };
        }
      });

      // Build response
      const response = {
        fixtures,
        tips: tipsWithDefaults,
        lastUpdated
      };

      return NextResponse.json(response);
    }

    // If no round/userId, just return fixtures
    return NextResponse.json(fixtures);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { round, userId, tips, lastUpdated, year: bodyYear } = await request.json();

    // Block writes for past years
    const blocked = blockWritesForPastYear(bodyYear || CURRENT_YEAR);
    if (blocked) return blocked;

    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_tips`);

    // Create bulk operations array
    const bulkOps = [];

    // First, mark all existing tips for this user and round as inactive
    bulkOps.push({
      updateMany: {
        filter: { 
          User: parseInt(userId),
          Round: parseInt(round)
        },
        update: { $set: { Active: 0 } }
      }
    });

    // Then, insert or update new tips
    Object.entries(tips).forEach(([matchNumber, tipData]) => {
      if (tipData && tipData.team) {
        bulkOps.push({
          updateOne: {
            filter: {
              User: parseInt(userId),
              Round: parseInt(round),
              MatchNumber: parseInt(matchNumber)
            },
            update: {
              $set: {
                Team: tipData.team,
                DeadCert: tipData.deadCert || false,
                Active: 1,
                LastUpdated: lastUpdated ? new Date(lastUpdated) : new Date(),
                IsDefault: tipData.isDefault || false
              }
            },
            upsert: true
          }
        });
      }
    });

    // Execute all operations in a single batch
    if (bulkOps.length > 0) {
      await collection.bulkWrite(bulkOps, { ordered: false });
    }

    // Invalidate tipping ladder cache for this round and onwards
    // Tips changing affects ladder calculations from this round forward
    try {
      const tippingLadderCache = db.collection(`${CURRENT_YEAR}_tipping_ladder_cache`);
      
      // Clear cache for rounds >= fromRound (when a specific round's tips change)
      await tippingLadderCache.deleteMany({
        year: CURRENT_YEAR,
        upToRound: { $gte: parseInt(round) }
      });
      
      console.log(`Invalidated tipping ladder cache from round ${round} onwards due to tip changes`);
    } catch (cacheError) {
      console.error('Error invalidating tipping ladder cache:', cacheError);
      // Don't fail the tip save if cache invalidation fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving tips:', error);
    return NextResponse.json(
      { error: 'Failed to save tips' },
      { status: 500 }
    );
  }
}
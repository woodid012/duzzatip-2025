import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

/**
 * GET handler for ladder data.
 * Retrieves ladder, using a cache that automatically updates.
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 0;
        
        const { db } = await connectToDatabase();
        
        // Automatically check and store results for any past rounds that need it.
        await checkAndStorePastRoundResults(db, round);
        
        const ladderCollection = db.collection(`${CURRENT_YEAR}_ladder`);
        
        // Check for a cached ladder
        const cachedLadder = await ladderCollection.findOne({ round: round });
        
        // Set a max age for the cache (e.g., 15 minutes)
        const CACHE_MAX_AGE_MS = 15 * 60 * 1000;
        const isCacheStale = !cachedLadder || !cachedLadder.lastUpdated || (new Date() - new Date(cachedLadder.lastUpdated) > CACHE_MAX_AGE_MS);
        
        if (cachedLadder && cachedLadder.standings && !isCacheStale) {
            console.log(`Returning fresh cached ladder for round ${round}`);
            return Response.json({
                standings: cachedLadder.standings,
                lastUpdated: cachedLadder.lastUpdated,
                fromCache: true
            });
        }
        
        // If cache is missing or stale, calculate a new ladder
        console.log(`Calculating new ladder for round ${round} (cache was ${cachedLadder ? 'stale' : 'missing'})`);
        const calculatedLadder = await calculateLadderFromAvailableData(db, round);
        
        const lastUpdated = new Date();

        // Save the newly calculated ladder to the cache
        await ladderCollection.updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    standings: calculatedLadder,
                    lastUpdated: lastUpdated,
                    calculatedFrom: 'auto_update'
                } 
            },
            { upsert: true }
        );
        
        return Response.json({
            standings: calculatedLadder,
            lastUpdated: lastUpdated,
            fromCache: false,
            calculated: true
        });
        
    } catch (error) {
        console.error('API Error in GET /api/ladder:', error);
        return Response.json({ error: 'Failed to fetch ladder data' }, { status: 500 });
    }
}

/**
 * POST handler to store/update ladder data (for manual overrides).
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, standings, forceRecalculate } = data;
        
        if (!round) {
            return Response.json({ error: 'Invalid data: round is required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        if (forceRecalculate) {
            console.log(`Force recalculating ladder for round ${round}`);
            const freshLadder = await calculateLadderFromAvailableData(db, round);
            
            await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
                { round: round },
                { $set: { round, standings: freshLadder, lastUpdated: new Date(), calculatedFrom: 'forced_recalculation' } },
                { upsert: true }
            );
            
            return Response.json({ success: true, standings: freshLadder, recalculated: true });
        }
        
        if (!Array.isArray(standings) || standings.length === 0) {
            return Response.json({ error: 'Invalid data: standings array required for manual update' }, { status: 400 });
        }
        
        await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
            { round: round },
            { $set: { round, standings, lastUpdated: new Date(), calculatedFrom: 'provided' } },
            { upsert: true }
        );
        
        return Response.json({ success: true });
    } catch (error) {
        console.error('API Error in POST /api/ladder:', error);
        return Response.json({ error: 'Failed to store ladder data' }, { status: 500 });
    }
}

/**
 * Checks all past rounds and stores their results if they are over a week old and not yet stored.
 */
async function checkAndStorePastRoundResults(db, currentRound) {
    try {
        for (let roundToCheck = 1; roundToCheck < currentRound; roundToCheck++) {
            const existingResults = await db.collection(`${CURRENT_YEAR}_round_results`).findOne({ round: roundToCheck });
            
            if (existingResults) {
                continue; // Already stored
            }
            
            const roundEndDate = await getRoundEndDate(roundToCheck);
            if (!roundEndDate) continue;
            
            const now = new Date();
            const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
            const oneWeekAfterRoundEnd = new Date(roundEndDate.getTime() + ONE_WEEK_MS);
            
            if (now > oneWeekAfterRoundEnd) {
                console.log(`Auto-storing results for round ${roundToCheck} (1 week has passed)`);
                await autoStoreRoundResults(db, roundToCheck);
            }
        }
    } catch (error) {
        console.error(`Error checking auto-store for currentRound ${currentRound}:`, error);
    }
}

/**
 * Fetches and stores the results for a specific round.
 */
async function autoStoreRoundResults(db, round) {
    try {
        const results = await calculateLiveRoundResults(round);
        
        if (Object.keys(results).length === 0) {
            console.warn(`No results to auto-store for round ${round}`);
            return;
        }

        await db.collection(`${CURRENT_YEAR}_round_results`).updateOne(
            { round: round },
            { $set: { round, results, lastUpdated: new Date(), source: 'auto_stored' } },
            { upsert: true }
        );
        
        console.log(`Auto-stored results for round ${round}:`, results);
        
    } catch (error) {
        console.error(`Error auto-storing results for round ${round}:`, error);
    }
}

/**
 * Gets the end date for a round (estimated as 3 hours after the last game).
 */
async function getRoundEndDate(round) {
    try {
        const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/tipping-data`);
        if (!response.ok) return null;
        
        const fixtures = await response.json();
        const roundFixtures = fixtures.filter(f => f.RoundNumber === round);
        
        if (roundFixtures.length === 0) return null;
        
        const lastFixture = roundFixtures.sort((a, b) => new Date(b.DateUtc) - new Date(a.DateUtc))[0];
        
        const roundEndDate = new Date(lastFixture.DateUtc);
        roundEndDate.setHours(roundEndDate.getHours() + 3);
        
        return roundEndDate;
        
    } catch (error) {
        console.error(`Error getting round end date for round ${round}:`, error);
        return null;
    }
}

/**
 * Calculates the ladder from all available data, using stored results where possible.
 */
async function calculateLadderFromAvailableData(db, currentRound) {
    const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
        userId, userName, played: 0, wins: 0, losses: 0, draws: 0,
        pointsFor: 0, pointsAgainst: 0, percentage: 0, points: 0
    }));

    for (let round = 1; round <= Math.min(currentRound, 21); round++) {
        let roundResults = null;
        
        const storedResults = await db.collection(`${CURRENT_YEAR}_round_results`).findOne({ round });
            
        if (storedResults && storedResults.results) {
            roundResults = storedResults.results;
        } else {
            console.log(`Calculating live results for round ${round}`);
            roundResults = await calculateLiveRoundResults(round);
        }
        
        if (!roundResults || Object.keys(roundResults).length === 0) {
            console.log(`No results available for round ${round}, skipping`);
            continue;
        }
        
        const fixtures = getFixturesForRound(round);
        
        fixtures.forEach(fixture => {
            const homeUserId = String(fixture.home);
            const awayUserId = String(fixture.away);
            
            if (roundResults[homeUserId] === undefined || roundResults[awayUserId] === undefined) {
                return;
            }
            
            const homeScore = roundResults[homeUserId];
            const awayScore = roundResults[awayUserId];
            
            const homeLadder = ladder.find(entry => entry.userId === homeUserId);
            const awayLadder = ladder.find(entry => entry.userId === awayUserId);
            
            if (homeLadder && awayLadder) {
                homeLadder.played++;
                awayLadder.played++;
                homeLadder.pointsFor += homeScore;
                homeLadder.pointsAgainst += awayScore;
                awayLadder.pointsFor += awayScore;
                awayLadder.pointsAgainst += homeScore;
                
                if (homeScore > awayScore) {
                    homeLadder.wins++;
                    homeLadder.points += 4;
                    awayLadder.losses++;
                } else if (awayScore > homeScore) {
                    awayLadder.wins++;
                    awayLadder.points += 4;
                    homeLadder.losses++;
                } else {
                    homeLadder.draws++;
                    homeLadder.points += 2;
                    awayLadder.draws++;
                    awayLadder.points += 2;
                }
            }
        });
    }

    ladder.forEach(team => {
        team.percentage = team.pointsAgainst === 0 
            ? (team.pointsFor > 0 ? (team.pointsFor * 100).toFixed(2) : '0.00')
            : ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
    });

    return ladder.sort((a, b) => b.points - a.points || b.percentage - a.percentage);
}

/**
 * Calculates live round results by calling the round-results API for all users.
 */
async function calculateLiveRoundResults(round) {
    const results = {};
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    
    const userPromises = Object.keys(USER_NAMES).map(async (userId) => {
        try {
            const response = await fetch(`${baseUrl}/api/round-results?round=${round}&userId=${userId}`);
            if (response.ok) {
                const userData = await response.json();
                return { userId, total: userData.total || 0 };
            }
        } catch (error) {
            console.error(`Error getting live results for user ${userId} round ${round}:`, error);
        }
        return { userId, total: 0 };
    });

    const userResults = await Promise.all(userPromises);
    userResults.forEach(({ userId, total }) => {
        results[userId] = total;
    });
    
    return results;
}

/**
 * DELETE handler to clear cached ladder data for a specific round.
 */
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        const result = await db.collection(`${CURRENT_YEAR}_ladder`).deleteOne({ round: round });
        
        if (result.deletedCount === 0) {
            return Response.json({ success: true, message: `No cached ladder to clear for round ${round}` });
        }

        return Response.json({ success: true, message: `Cleared cached ladder for round ${round}` });
        
    } catch (error) {
        console.error('API Error in DELETE /api/ladder:', error);
        return Response.json({ error: 'Failed to clear ladder data' }, { status: 500 });
    }
}
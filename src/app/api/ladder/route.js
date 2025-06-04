import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

/**
 * GET handler for ladder data
 * Retrieves current live ladder or calculates it from stored results
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 0;
        
        const { db } = await connectToDatabase();
        
        // Check if round results should be automatically stored
        await checkAndStoreRoundResults(db, round);
        
        // Try to get cached ladder first
        const cachedLadder = await db.collection(`${CURRENT_YEAR}_ladder`)
            .findOne({ round: round });
        
        if (cachedLadder && cachedLadder.standings) {
            console.log(`Returning cached ladder for round ${round}`);
            return Response.json({
                standings: cachedLadder.standings,
                lastUpdated: cachedLadder.lastUpdated,
                fromCache: true
            });
        }
        
        // If no cached data, calculate from stored results or live data
        console.log(`Calculating ladder for round ${round}`);
        const calculatedLadder = await calculateLadderFromAvailableData(db, round);
        
        return Response.json({
            standings: calculatedLadder,
            fromCache: false,
            calculated: true
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch ladder data' }, { status: 500 });
    }
}

/**
 * POST handler to store/update ladder data (kept for manual overrides if needed)
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, standings, forceRecalculate } = data;
        
        if (!round || !Array.isArray(standings) || standings.length === 0) {
            return Response.json(
                { error: 'Invalid data: round and standings array required' }, 
                { status: 400 }
            );
        }
        
        const { db } = await connectToDatabase();
        
        // If force recalculate is requested, calculate fresh ladder
        if (forceRecalculate) {
            console.log(`Force recalculating ladder for round ${round}`);
            const freshLadder = await calculateLadderFromAvailableData(db, round);
            
            // Store the fresh calculation
            await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
                { round: round },
                { 
                    $set: { 
                        round: round,
                        standings: freshLadder,
                        lastUpdated: new Date(),
                        calculatedFrom: 'forced_recalculation'
                    } 
                },
                { upsert: true }
            );
            
            return Response.json({ 
                success: true, 
                standings: freshLadder,
                recalculated: true 
            });
        }
        
        // Otherwise, store the provided standings
        await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    standings: standings,
                    lastUpdated: new Date(),
                    calculatedFrom: 'provided'
                } 
            },
            { upsert: true }
        );
        
        return Response.json({ success: true });
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to store ladder data' }, { status: 500 });
    }
}

/**
 * Check if round results should be automatically stored (1 week after round completion)
 */
async function checkAndStoreRoundResults(db, round) {
    try {
        // Don't auto-store for current round or future rounds
        if (round === 0) return; // Skip opening round
        
        // Check if results are already stored
        const existingResults = await db.collection(`${CURRENT_YEAR}_round_results`)
            .findOne({ round: round });
            
        if (existingResults) {
            console.log(`Results already stored for round ${round}`);
            return; // Already stored
        }
        
        // Calculate if round ended more than 1 week ago
        const roundEndDate = await getRoundEndDate(round);
        if (!roundEndDate) return;
        
        const now = new Date();
        const oneWeekAfterRoundEnd = new Date(roundEndDate.getTime() + (7 * 24 * 60 * 60 * 1000));
        
        if (now > oneWeekAfterRoundEnd) {
            console.log(`Auto-storing results for round ${round} (1 week has passed)`);
            await autoStoreRoundResults(db, round);
        }
        
    } catch (error) {
        console.error(`Error checking auto-store for round ${round}:`, error);
    }
}

/**
 * Automatically store round results
 */
async function autoStoreRoundResults(db, round) {
    try {
        // Calculate current results using the live scoring system
        const results = {};
        
        // Call the existing round-results API for each user to get their complete scores
        for (const userId of Object.keys(USER_NAMES)) {
            try {
                const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
                const response = await fetch(`${baseUrl}/api/round-results?round=${round}&userId=${userId}`);
                
                if (response.ok) {
                    const userData = await response.json();
                    results[userId] = userData.total || 0;
                    console.log(`Auto-stored score for user ${userId} round ${round}: ${userData.total}`);
                } else {
                    console.warn(`Failed to get results for user ${userId} in round ${round}: ${response.status}`);
                    results[userId] = 0;
                }
            } catch (error) {
                console.error(`Error getting results for user ${userId}:`, error);
                results[userId] = 0;
            }
        }
        
        // Store the results
        await db.collection(`${CURRENT_YEAR}_round_results`).updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    results: results,
                    lastUpdated: new Date(),
                    source: 'auto_stored',
                    userCount: Object.keys(results).length
                } 
            },
            { upsert: true }
        );
        
        console.log(`Auto-stored results for round ${round}:`, results);
        
    } catch (error) {
        console.error(`Error auto-storing results for round ${round}:`, error);
    }
}

/**
 * Get round end date (3 hours after last fixture)
 */
async function getRoundEndDate(round) {
    try {
        // This would need to fetch from your fixtures API or database
        // For now, using a simplified approach
        const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/tipping-data`);
        if (!response.ok) return null;
        
        const fixtures = await response.json();
        const roundFixtures = fixtures.filter(f => f.RoundNumber === round);
        
        if (roundFixtures.length === 0) return null;
        
        // Get last fixture of the round
        const lastFixture = roundFixtures.sort((a, b) => new Date(b.DateUtc) - new Date(a.DateUtc))[0];
        
        // Add 3 hours to get round end time
        const roundEndDate = new Date(lastFixture.DateUtc);
        roundEndDate.setHours(roundEndDate.getHours() + 3);
        
        return roundEndDate;
        
    } catch (error) {
        console.error(`Error getting round end date for round ${round}:`, error);
        return null;
    }
}

/**
 * Calculate ladder from available data (stored results or live calculation)
 */
async function calculateLadderFromAvailableData(db, currentRound) {
    try {
        // Initialize ladder with all users
        const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
            userId,
            userName,
            played: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            percentage: 0,
            points: 0
        }));

        // Process regular season rounds (1 up to currentRound)
        for (let round = 1; round <= Math.min(currentRound, 21); round++) {
            let roundResults = null;
            
            // Try to get stored results first
            const storedResults = await db.collection(`${CURRENT_YEAR}_round_results`)
                .findOne({ round: round });
                
            if (storedResults && storedResults.results) {
                roundResults = storedResults.results;
                console.log(`Using stored results for round ${round}`);
            } else {
                // Calculate live results for this round
                console.log(`Calculating live results for round ${round}`);
                roundResults = await calculateLiveRoundResults(round);
            }
            
            if (!roundResults || Object.keys(roundResults).length === 0) {
                console.log(`No results available for round ${round}, skipping`);
                continue;
            }
            
            // Get fixtures for this round
            const fixtures = getFixturesForRound(round);
            
            // Process each fixture
            fixtures.forEach(fixture => {
                const homeUserId = String(fixture.home);
                const awayUserId = String(fixture.away);
                
                // Skip if scores aren't available for either team
                if (!roundResults[homeUserId] || !roundResults[awayUserId]) {
                    console.log(`Missing results for fixture ${homeUserId} vs ${awayUserId} in round ${round}`);
                    return;
                }
                
                const homeScore = roundResults[homeUserId];
                const awayScore = roundResults[awayUserId];
                
                const homeLadder = ladder.find(entry => entry.userId === homeUserId);
                const awayLadder = ladder.find(entry => entry.userId === awayUserId);
                
                if (homeLadder && awayLadder) {
                    homeLadder.played += 1;
                    awayLadder.played += 1;
                    
                    homeLadder.pointsFor += homeScore;
                    homeLadder.pointsAgainst += awayScore;
                    
                    awayLadder.pointsFor += awayScore;
                    awayLadder.pointsAgainst += homeScore;
                    
                    if (homeScore > awayScore) {
                        // Home team wins
                        homeLadder.wins += 1;
                        homeLadder.points += 4;
                        awayLadder.losses += 1;
                    } else if (awayScore > homeScore) {
                        // Away team wins
                        awayLadder.wins += 1;
                        awayLadder.points += 4;
                        homeLadder.losses += 1;
                    } else {
                        // Draw
                        homeLadder.draws += 1;
                        homeLadder.points += 2;
                        awayLadder.draws += 1;
                        awayLadder.points += 2;
                    }
                }
            });
        }

        // Calculate percentages
        ladder.forEach(team => {
            team.percentage = team.pointsAgainst === 0 
                ? team.pointsFor * 100 
                : ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
        });

        // Sort ladder by points, then percentage
        return ladder.sort((a, b) => {
            if (b.points !== a.points) {
                return b.points - a.points;
            }
            return b.percentage - a.percentage;
        });
        
    } catch (error) {
        console.error('Error calculating ladder from available data:', error);
        throw error;
    }
}

/**
 * Calculate live round results using the existing round-results API
 */
async function calculateLiveRoundResults(round) {
    try {
        const results = {};
        
        // Use the existing round-results API endpoint for each user
        for (const userId of Object.keys(USER_NAMES)) {
            try {
                const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
                const response = await fetch(`${baseUrl}/api/round-results?round=${round}&userId=${userId}`);
                
                if (response.ok) {
                    const userData = await response.json();
                    results[userId] = userData.total || 0;
                    console.log(`Got live score for user ${userId} round ${round}: ${userData.total}`);
                } else {
                    console.warn(`Failed to get live results for user ${userId} in round ${round}: ${response.status}`);
                    results[userId] = 0;
                }
            } catch (error) {
                console.error(`Error getting live results for user ${userId} round ${round}:`, error);
                results[userId] = 0;
            }
        }
        
        return results;
        
    } catch (error) {
        console.error('Error calculating live round results:', error);
        return {};
    }
}

/**
 * DELETE handler to clear cached ladder data
 */
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        await db.collection(`${CURRENT_YEAR}_ladder`).deleteOne({ round: round });
        
        return Response.json({ success: true, message: `Cleared cached ladder for round ${round}` });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to clear ladder data' }, { status: 500 });
    }
}
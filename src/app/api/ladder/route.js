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
        
        // If no cached data, calculate from stored results
        console.log(`Calculating ladder for round ${round} from stored results`);
        const calculatedLadder = await calculateLadderFromDatabase(db, round);
        
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
 * POST handler to store/update ladder data
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
            const freshLadder = await calculateLadderFromDatabase(db, round);
            
            // Store the fresh calculation
            await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
                { round: round },
                { 
                    $set: { 
                        round: round,
                        standings: freshLadder,
                        lastUpdated: new Date(),
                        calculatedFrom: 'database'
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
 * Calculate ladder from stored database results
 */
async function calculateLadderFromDatabase(db, currentRound) {
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
            // Get stored results for this round
            const roundResults = await getRoundResultsFromDatabase(db, round);
            
            if (!roundResults || Object.keys(roundResults).length === 0) {
                console.log(`No stored results found for round ${round}, skipping`);
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
        console.error('Error calculating ladder from database:', error);
        throw error;
    }
}

/**
 * Get round results from database - tries multiple sources
 */
async function getRoundResultsFromDatabase(db, round) {
    try {
        // Try to get from round_results collection first (if it exists)
        const roundResultsCollection = db.collection(`${CURRENT_YEAR}_round_results`);
        const storedResults = await roundResultsCollection.findOne({ round: round });
        
        if (storedResults && storedResults.results) {
            console.log(`Found stored round results for round ${round}`);
            return storedResults.results;
        }
        
        // Fallback: Calculate from team selections and game stats
        console.log(`Calculating round results for round ${round} from team selections`);
        return await calculateRoundResultsFromTeamSelections(db, round);
        
    } catch (error) {
        console.error(`Error getting round results for round ${round}:`, error);
        return {};
    }
}

/**
 * Calculate round results from team selections and player stats using existing scoring system
 */
async function calculateRoundResultsFromTeamSelections(db, round) {
    try {
        const results = {};
        
        // Use the existing round-results API endpoint for each user
        // This will use your complete scoring system including substitutions
        for (const userId of Object.keys(USER_NAMES)) {
            try {
                // Make internal API call to your existing round-results endpoint
                const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
                const response = await fetch(`${baseUrl}/api/round-results?round=${round}&userId=${userId}`);
                
                if (response.ok) {
                    const userData = await response.json();
                    results[userId] = userData.total || 0;
                    console.log(`Got score for user ${userId} round ${round}: ${userData.total}`);
                } else {
                    console.warn(`Failed to get results for user ${userId} in round ${round}: ${response.status}`);
                    results[userId] = 0;
                }
            } catch (error) {
                console.error(`Error getting results for user ${userId} round ${round}:`, error);
                results[userId] = 0;
            }
        }
        
        console.log(`Calculated round ${round} results:`, results);
        return results;
        
    } catch (error) {
        console.error('Error calculating round results from team selections:', error);
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
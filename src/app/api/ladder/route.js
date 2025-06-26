import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

/**
 * GET handler for ladder data.
 * Gets the Final Total directly from the database (stored by results page)
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 0;
        const getRoundSummary = searchParams.get('getRoundSummary') === 'true';
        
        const { db } = await connectToDatabase();
        
        // Handle round summary requests
        if (getRoundSummary) {
            return await handleGetRoundSummary(round, db);
        }
        
        const ladderCollection = db.collection(`${CURRENT_YEAR}_ladder`);
        
        // Check for a cached ladder
        const cachedLadder = await ladderCollection.findOne({ round: round });
        
        // Set a max age for the cache (e.g., 15 minutes)
        const CACHE_MAX_AGE_MS = 15 * 60 * 1000;
        const isCacheStale = !cachedLadder || !cachedLadder.lastUpdated || (new Date() - new Date(cachedLadder.lastUpdated) > CACHE_MAX_AGE_MS);
        
        if (cachedLadder && cachedLadder.standings && !isCacheStale) {
            
            return Response.json({
                standings: cachedLadder.standings,
                lastUpdated: cachedLadder.lastUpdated,
                fromCache: true
            });
        }
        
        // If cache is missing or stale, build ladder from Final Totals stored in database
        
        const calculatedLadder = await buildLadderFromStoredFinalTotals(round, db);
        
        const lastUpdated = new Date();

        // Save the newly calculated ladder to the cache
        await ladderCollection.updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    standings: calculatedLadder,
                    lastUpdated: lastUpdated,
                    calculatedFrom: 'stored_final_totals_direct'
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
 * Handle GET requests for round summary data
 */
async function handleGetRoundSummary(round, db) {
    try {
        if (!round) {
            return Response.json({ error: 'Round is required for summary request' }, { status: 400 });
        }

        const results = await db.collection(`${CURRENT_YEAR}_round_summaries`)
            .find({ round: round })
            .toArray();
        
        const userResults = {};
        let roundSummary = null;
        
        results.forEach(result => {
            if (result.userId === 'ROUND_SUMMARY') {
                roundSummary = {
                    highestScore: result.highestScore,
                    lowestScore: result.lowestScore,
                    starWinners: result.starWinners,
                    crabWinners: result.crabWinners
                };
            } else if (result.userId) {
                userResults[result.userId] = {
                    score: result.score,
                    matchResult: result.matchResult,
                    opponent: result.opponent,
                    opponentScore: result.opponentScore,
                    isHome: result.isHome,
                    earnedStar: result.earnedStar,
                    earnedCrab: result.earnedCrab
                };
            }
        });
        
        return Response.json({
            found: results.length > 0,
            round,
            userResults,
            roundSummary
        });

    } catch (error) {
        console.error('API Error in GET round summary:', error);
        return Response.json({ error: 'Failed to get round summary' }, { status: 500 });
    }
}

/**
 * Build ladder using Final Totals stored directly in database by results page
 * This gets the exact same values that show as "Final Total" on the results page
 */
async function buildLadderFromStoredFinalTotals(currentRound, db) {
    
    
    const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
        userId, userName, played: 0, wins: 0, losses: 0, draws: 0,
        pointsFor: 0, pointsAgainst: 0, percentage: 0, points: 0
    }));

    // Process rounds 1 through currentRound (up to 21 for regular season)
    for (let round = 1; round <= Math.min(currentRound, 21); round++) {
        
        
        // Get Final Totals directly from database (stored by results page)
        const finalTotals = await getStoredFinalTotals(round, db);
        
        if (!finalTotals || Object.keys(finalTotals).length === 0) {
            
            continue;
        }
        
        
        
        const fixtures = getFixturesForRound(round);
        
        fixtures.forEach((fixture) => {
            const homeUserId = String(fixture.home);
            const awayUserId = String(fixture.away);
            
            const homeScore = finalTotals[homeUserId] || 0;
            const awayScore = finalTotals[awayUserId] || 0;
            
            // Skip if both scores are 0 (no data)
            if (homeScore === 0 && awayScore === 0) {
                
                return;
            }
            
            
            
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

    // Calculate percentages
    ladder.forEach(team => {
        team.percentage = team.pointsAgainst === 0 
            ? (team.pointsFor > 0 ? (team.pointsFor * 100).toFixed(2) : '0.00')
            : ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
    });

    // Sort ladder by points, then percentage
    const sortedLadder = ladder.sort((a, b) => b.points - a.points || b.percentage - a.percentage);
    
    
    return sortedLadder;
}

/**
 * Get the Final Totals stored directly in database by the results page
 * This avoids any API call issues and gets data directly from the same source
 */
async function getStoredFinalTotals(round, db) {
    
    
    try {
        const finalTotalsCollection = db.collection(`${CURRENT_YEAR}_final_totals`);
        
        // Get all Final Totals for this round
        const results = await finalTotalsCollection
            .find({ round: round })
            .toArray();
        
        if (!results || results.length === 0) {
            
            return {};
        }
        
        // Convert to the expected format
        const finalTotals = {};
        results.forEach(result => {
            if (result.userId && result.finalTotal !== undefined) {
                finalTotals[result.userId] = result.finalTotal || 0;
            }
        });
        
        
        return finalTotals;
        
    } catch (error) {
        console.error(`Error getting stored Final Totals for round ${round}:`, error);
        return {};
    }
}

/**
 * Enhanced POST handler to store/update ladder data AND calculate round summaries
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, standings, forceRecalculate, calculateRoundSummary } = data;
        
        if (!round) {
            return Response.json({ error: 'Invalid data: round is required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        // Handle round summary calculation
        if (calculateRoundSummary) {
            
            
            const summaryResult = await calculateAndStoreRoundSummary(round, db, forceRecalculate);
            return Response.json(summaryResult);
        }
        
        // Existing ladder recalculation logic
        if (forceRecalculate) {
            
            const freshLadder = await buildLadderFromStoredFinalTotals(round, db);
            
            await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
                { round: round },
                { $set: { round, standings: freshLadder, lastUpdated: new Date(), calculatedFrom: 'forced_stored_final_totals' } },
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
 * Calculate and store round summary data for faster loading
 * This should be called for Current Round - 1 to pre-calculate completed round data
 */
async function calculateAndStoreRoundSummary(round, db, forceRecalculate = false) {
    try {
        const collection = db.collection(`${CURRENT_YEAR}_round_summaries`);

        // Check if we already have data for this round (unless forcing recalculation)
        if (!forceRecalculate) {
            const existingCount = await collection.countDocuments({ round: round });
            if (existingCount > 0) {
                
                return { 
                    success: true, 
                    message: `Round summary already exists for round ${round}`,
                    skipped: true 
                };
            }
        }

        // Get Final Totals for this round (the authoritative scores)
        const finalTotals = await getStoredFinalTotals(round, db);
        
        if (!finalTotals || Object.keys(finalTotals).length === 0) {
            return { 
                success: false,
                error: `No Final Totals available for round ${round}. Cannot calculate summary.` 
            };
        }

        

        // Calculate round summary data
        const roundSummary = await calculateRoundSummaryData(round, finalTotals);

        // Store the calculated data
        const bulkOps = [];
        const lastUpdated = new Date();

        Object.entries(roundSummary.userResults).forEach(([userId, userData]) => {
            bulkOps.push({
                updateOne: {
                    filter: { round: round, userId: userId },
                    update: { 
                        $set: { 
                            round: round,
                            userId: userId,
                            score: userData.score,
                            matchResult: userData.matchResult, // 'W', 'L', 'D'
                            opponent: userData.opponent,
                            opponentScore: userData.opponentScore,
                            isHome: userData.isHome,
                            earnedStar: userData.earnedStar,
                            earnedCrab: userData.earnedCrab,
                            lastUpdated: lastUpdated,
                            calculatedFrom: 'final_totals'
                        } 
                    },
                    upsert: true
                }
            });
        });

        // Also store round-level summary
        bulkOps.push({
            updateOne: {
                filter: { round: round, userId: 'ROUND_SUMMARY' },
                update: { 
                    $set: { 
                        round: round,
                        userId: 'ROUND_SUMMARY',
                        highestScore: roundSummary.highestScore,
                        lowestScore: roundSummary.lowestScore,
                        starWinners: roundSummary.starWinners,
                        crabWinners: roundSummary.crabWinners,
                        lastUpdated: lastUpdated,
                        calculatedFrom: 'final_totals'
                    } 
                },
                upsert: true
            }
        });

        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps);
        }

        

        return { 
            success: true,
            message: `Calculated and stored round summary for round ${round}`,
            round,
            userCount: Object.keys(roundSummary.userResults).length,
            highestScore: roundSummary.highestScore,
            lowestScore: roundSummary.lowestScore,
            starWinners: roundSummary.starWinners,
            crabWinners: roundSummary.crabWinners
        };

    } catch (error) {
        console.error('Error calculating round summary:', error);
        return { 
            success: false, 
            error: 'Failed to calculate round summary: ' + error.message 
        };
    }
}

/**
 * Calculate comprehensive round summary data
 */
async function calculateRoundSummaryData(round, finalTotals) {
    console.log(`Calculating round summary data for round ${round}`);
    
    const userResults = {};
    const fixtures = getFixturesForRound(round);
    
    // Initialize all users
    Object.keys(USER_NAMES).forEach(userId => {
        userResults[userId] = {
            score: finalTotals[userId] || 0,
            matchResult: null,
            opponent: null,
            opponentScore: 0,
            isHome: false,
            earnedStar: false,
            earnedCrab: false
        };
    });
    
    // Process fixtures to determine match results
    fixtures.forEach(fixture => {
        const homeUserId = String(fixture.home);
        const awayUserId = String(fixture.away);
        
        const homeScore = finalTotals[homeUserId] || 0;
        const awayScore = finalTotals[awayUserId] || 0;
        
        // Skip if both scores are 0 (no data)
        if (homeScore === 0 && awayScore === 0) {
            return;
        }
        
        // Set opponent information
        if (userResults[homeUserId]) {
            userResults[homeUserId].opponent = USER_NAMES[awayUserId];
            userResults[homeUserId].opponentScore = awayScore;
            userResults[homeUserId].isHome = true;
        }
        
        if (userResults[awayUserId]) {
            userResults[awayUserId].opponent = USER_NAMES[homeUserId];
            userResults[awayUserId].opponentScore = homeScore;
            userResults[awayUserId].isHome = false;
        }
        
        // Determine match results
        if (homeScore > awayScore) {
            if (userResults[homeUserId]) userResults[homeUserId].matchResult = 'W';
            if (userResults[awayUserId]) userResults[awayUserId].matchResult = 'L';
        } else if (awayScore > homeScore) {
            if (userResults[awayUserId]) userResults[awayUserId].matchResult = 'W';
            if (userResults[homeUserId]) userResults[homeUserId].matchResult = 'L';
        } else {
            if (userResults[homeUserId]) userResults[homeUserId].matchResult = 'D';
            if (userResults[awayUserId]) userResults[awayUserId].matchResult = 'D';
        }
    });
    
    // Calculate stars and crabs
    const scores = Object.entries(finalTotals)
        .map(([userId, score]) => ({ userId, score: Number(score) }))
        .filter(s => s.score > 0); // Only consider scores > 0
    
    let highestScore = 0;
    let lowestScore = 0;
    let starWinners = [];
    let crabWinners = [];
    
    if (scores.length > 0) {
        highestScore = Math.max(...scores.map(s => s.score));
        lowestScore = Math.min(...scores.map(s => s.score));
        
        // Award stars (highest score)
        starWinners = scores
            .filter(s => s.score === highestScore)
            .map(s => s.userId);
        
        // Award crabs (lowest score, but only if different from highest)
        if (lowestScore < highestScore) {
            crabWinners = scores
                .filter(s => s.score === lowestScore)
                .map(s => s.userId);
        }
        
        // Mark star and crab winners in user results
        starWinners.forEach(userId => {
            if (userResults[userId]) {
                userResults[userId].earnedStar = true;
            }
        });
        
        crabWinners.forEach(userId => {
            if (userResults[userId]) {
                userResults[userId].earnedCrab = true;
            }
        });
    }
    
    return {
        userResults,
        highestScore,
        lowestScore,
        starWinners,
        crabWinners
    };
}

/**
 * DELETE handler to clear cached ladder data for a specific round.
 */
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        const clearSummary = searchParams.get('clearSummary') === 'true';
        
        if (!round) {
            return Response.json({ error: 'Round parameter required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        if (clearSummary) {
            // Clear round summary data
            const result = await db.collection(`${CURRENT_YEAR}_round_summaries`).deleteMany({ round: round });
            return Response.json({ 
                success: true, 
                message: `Cleared ${result.deletedCount} round summary records for round ${round}`
            });
        } else {
            // Clear ladder cache
            const result = await db.collection(`${CURRENT_YEAR}_ladder`).deleteOne({ round: round });
            
            if (result.deletedCount === 0) {
                return Response.json({ success: true, message: `No cached ladder to clear for round ${round}` });
            }

            return Response.json({ success: true, message: `Cleared cached ladder for round ${round}` });
        }
        
    } catch (error) {
        console.error('API Error in DELETE /api/ladder:', error);
        return Response.json({ error: 'Failed to clear ladder data' }, { status: 500 });
    }
}
// New file: /api/sync-results-from-results-page/route.js
import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

/**
 * POST handler to sync results from the results page logic for specific rounds
 */
export async function POST(request) {
    try {
        const { round, rounds, forceUpdate } = await request.json();
        
        // Determine which rounds to sync
        let roundsToSync = [];
        if (round) {
            roundsToSync = [parseInt(round)];
        } else if (rounds && Array.isArray(rounds)) {
            roundsToSync = rounds.map(r => parseInt(r));
        } else {
            // Default: sync rounds 1-21
            roundsToSync = Array.from({ length: 21 }, (_, i) => i + 1);
        }
        
        const { db } = await connectToDatabase();
        const syncResults = [];
        
        for (const roundToSync of roundsToSync) {
            console.log(`Syncing results for round ${roundToSync}`);
            
            try {
                // Check if results already exist and whether to skip
                if (!forceUpdate) {
                    const existingResults = await db.collection(`${CURRENT_YEAR}_round_results`)
                        .findOne({ round: roundToSync });
                    
                    if (existingResults) {
                        console.log(`Results already exist for round ${roundToSync}, skipping (use forceUpdate: true to override)`);
                        syncResults.push({
                            round: roundToSync,
                            status: 'skipped',
                            reason: 'Results already exist'
                        });
                        continue;
                    }
                }
                
                // Fetch results from the results page logic
                const roundResults = await fetchResultsFromResultsPageLogic(roundToSync);
                
                if (!roundResults || Object.keys(roundResults).length === 0) {
                    syncResults.push({
                        round: roundToSync,
                        status: 'failed',
                        reason: 'No results could be calculated'
                    });
                    continue;
                }
                
                // Store the results
                await db.collection(`${CURRENT_YEAR}_round_results`).updateOne(
                    { round: roundToSync },
                    { 
                        $set: { 
                            round: roundToSync,
                            results: roundResults,
                            lastUpdated: new Date(),
                            source: 'synced_from_results_page_logic'
                        } 
                    },
                    { upsert: true }
                );
                
                console.log(`Successfully synced results for round ${roundToSync}:`, roundResults);
                
                syncResults.push({
                    round: roundToSync,
                    status: 'success',
                    results: roundResults,
                    userCount: Object.keys(roundResults).length
                });
                
                // Also clear the ladder cache for this round so it recalculates
                await db.collection(`${CURRENT_YEAR}_ladder`).deleteOne({ round: roundToSync });
                
            } catch (error) {
                console.error(`Error syncing round ${roundToSync}:`, error);
                syncResults.push({
                    round: roundToSync,
                    status: 'error',
                    error: error.message
                });
            }
        }
        
        return Response.json({
            success: true,
            message: `Synced ${roundsToSync.length} rounds`,
            results: syncResults
        });
        
    } catch (error) {
        console.error('API Error in sync-results-from-results-page:', error);
        return Response.json({ error: 'Failed to sync results' }, { status: 500 });
    }
}

/**
 * GET handler to show current stored results
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = searchParams.get('round');
        
        const { db } = await connectToDatabase();
        
        if (round) {
            // Get specific round
            const storedResults = await db.collection(`${CURRENT_YEAR}_round_results`)
                .findOne({ round: parseInt(round) });
            
            return Response.json({
                round: parseInt(round),
                found: !!storedResults,
                results: storedResults?.results || {},
                lastUpdated: storedResults?.lastUpdated,
                source: storedResults?.source
            });
        } else {
            // Get all rounds
            const allResults = await db.collection(`${CURRENT_YEAR}_round_results`)
                .find({})
                .sort({ round: 1 })
                .toArray();
            
            return Response.json({
                totalRounds: allResults.length,
                rounds: allResults.map(r => ({
                    round: r.round,
                    userCount: Object.keys(r.results || {}).length,
                    lastUpdated: r.lastUpdated,
                    source: r.source
                }))
            });
        }
        
    } catch (error) {
        console.error('API Error in GET sync-results-from-results-page:', error);
        return Response.json({ error: 'Failed to get stored results' }, { status: 500 });
    }
}

/**
 * Fetch the EXACT "Final Total" scores from the results page calculation
 */
async function fetchResultsFromResultsPageLogic(round) {
    try {
        console.log(`Fetching EXACT Final Total scores from results page for round ${round}`);
        
        const results = {};
        
        // For each user, get their exact "Final Total" score using the results page logic
        for (const userId of Object.keys(USER_NAMES)) {
            try {
                // Call the exact same function that gets the Final Total score
                const finalTotalScore = await getExactFinalTotalFromResultsPage(userId, round);
                results[userId] = finalTotalScore;
                
                console.log(`User ${userId} Round ${round}: Final Total = ${finalTotalScore}`);
                
            } catch (error) {
                console.error(`Error getting Final Total for user ${userId} round ${round}:`, error);
                results[userId] = 0;
            }
        }
        
        console.log(`Final exact results for round ${round}:`, results);
        return results;
        
    } catch (error) {
        console.error(`Error fetching exact results for round ${round}:`, error);
        return {};
    }
}

/**
 * Get the EXACT "Final Total" score that appears on the results page
 */
async function getExactFinalTotalFromResultsPage(userId, round) {
    try {
        const baseUrl = getBaseUrl();
        
        // Get team selection data
        const teamSelectionRes = await fetch(`${baseUrl}/api/team-selection?round=${round}`);
        if (!teamSelectionRes.ok) {
            console.warn(`Failed to get team selection for round ${round}`);
            return 0;
        }
        const teamSelectionData = await teamSelectionRes.json();
        const userTeam = teamSelectionData[userId];
        
        if (!userTeam) {
            console.log(`No team selection found for user ${userId} round ${round}`);
            return 0;
        }

        // Get all player stats for this round
        const playerStatsRes = await fetch(`${baseUrl}/api/all-stats?round=${round}`);
        if (!playerStatsRes.ok) {
            console.warn(`Failed to get player stats for round ${round}`);
            return 0;
        }
        const allPlayerStats = await playerStatsRes.json();
        
        // Convert to map for easier lookup
        const playerStatsMap = {};
        allPlayerStats.forEach(player => {
            playerStatsMap[player.player_name] = player;
        });

        // Get dead cert scores
        let deadCertScore = 0;
        try {
            const tippingRes = await fetch(`${baseUrl}/api/tipping-results?round=${round}&userId=${userId}`);
            if (tippingRes.ok) {
                const tippingData = await tippingRes.json();
                deadCertScore = tippingData.deadCertScore || 0;
            }
        } catch (tippingError) {
            console.error(`Error getting tipping results for user ${userId} round ${round}:`, tippingError);
            deadCertScore = 0;
        }

        // Calculate team scores using the EXACT same logic as useResults hook
        const teamScoreData = calculateTeamScoresLikeResultsPage(userTeam, playerStatsMap, round);
        
        // Final Total = team score + dead cert score (exactly like results page)
        const finalTotal = teamScoreData.totalScore + deadCertScore;
        
        console.log(`User ${userId} Round ${round}: Team=${teamScoreData.totalScore}, DeadCert=${deadCertScore}, Final Total=${finalTotal}`);
        
        return finalTotal;
        
    } catch (error) {
        console.error(`Error getting exact Final Total for user ${userId} round ${round}:`, error);
        return 0;
    }
}

/**
 * Get the base URL for internal API calls
 */
function getBaseUrl() {
    return process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
}
import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

/**
 * GET handler for stored round results
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter is required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        // Get stored results for this round
        const storedResults = await db.collection(`${CURRENT_YEAR}_round_results`)
            .findOne({ round: round });
        
        if (storedResults) {
            return Response.json({
                round: storedResults.round,
                results: storedResults.results,
                lastUpdated: storedResults.lastUpdated,
                found: true
            });
        }
        
        return Response.json({
            round: round,
            results: {},
            found: false,
            message: `No stored results found for round ${round}`
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch round results' }, { status: 500 });
    }
}

/**
 * POST handler to store round results
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, results, source } = data;
        
        if (!round || !results || typeof results !== 'object') {
            return Response.json(
                { error: 'Invalid data: round and results object required' }, 
                { status: 400 }
            );
        }
        
        // Validate that results contain valid user IDs
        const validUserIds = Object.keys(USER_NAMES);
        const resultUserIds = Object.keys(results);
        
        const invalidUsers = resultUserIds.filter(userId => !validUserIds.includes(userId));
        if (invalidUsers.length > 0) {
            return Response.json(
                { error: `Invalid user IDs: ${invalidUsers.join(', ')}` }, 
                { status: 400 }
            );
        }
        
        const { db } = await connectToDatabase();
        
        // Store the round results
        await db.collection(`${CURRENT_YEAR}_round_results`).updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    results: results,
                    lastUpdated: new Date(),
                    source: source || 'manual',
                    userCount: Object.keys(results).length
                } 
            },
            { upsert: true }
        );
        
        console.log(`Stored results for round ${round}: ${Object.keys(results).length} users`);
        
        // Also trigger ladder recalculation
        try {
            const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
            const ladderResponse = await fetch(`${baseUrl}/api/ladder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    round: round,
                    standings: [], // Will be recalculated
                    forceRecalculate: true
                })
            });
            
            if (!ladderResponse.ok) {
                console.warn('Failed to trigger ladder recalculation');
            }
        } catch (ladderError) {
            console.warn('Error triggering ladder recalculation:', ladderError);
        }
        
        return Response.json({ 
            success: true, 
            message: `Stored results for round ${round}`,
            userCount: Object.keys(results).length
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to store round results' }, { status: 500 });
    }
}

/**
 * PUT handler to calculate and store current round results
 */
export async function PUT(request) {
    try {
        const data = await request.json();
        const { round, forceRecalculate } = data;
        
        if (!round) {
            return Response.json({ error: 'Round parameter is required' }, { status: 400 });
        }
        
        // Check if results already exist and don't force recalculate
        if (!forceRecalculate) {
            try {
                const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
                const existingResults = await fetch(`${baseUrl}/api/store-round-results?round=${round}`);
                if (existingResults.ok) {
                    const existingData = await existingResults.json();
                    if (existingData.found) {
                        return Response.json({
                            success: true,
                            message: `Results for round ${round} already exist`,
                            results: existingData.results,
                            skipped: true
                        });
                    }
                }
            } catch (checkError) {
                console.warn('Error checking existing results:', checkError);
            }
        }
        
        console.log(`Calculating and storing results for round ${round}`);
        
        // Calculate current results using the existing results logic
        const calculatedResults = await calculateCurrentRoundResults(round);
        
        if (!calculatedResults || Object.keys(calculatedResults).length === 0) {
            return Response.json({
                success: false,
                message: `Could not calculate results for round ${round}`,
                results: {}
            }, { status: 400 });
        }
        
        // Store the calculated results
        try {
            const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
            const storeResponse = await fetch(`${baseUrl}/api/final-totals`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    round: round,
                    allFinalTotals: calculatedResults,
                })
            });
            
            if (!storeResponse.ok) {
                const errorData = await storeResponse.json();
                throw new Error(errorData.error || 'Failed to store calculated results');
            }
        } catch (storeError) {
            console.error('Error storing calculated results:', storeError);
            throw storeError;
        }
        
        return Response.json({
            success: true,
            message: `Calculated and stored results for round ${round}`,
            results: calculatedResults,
            userCount: Object.keys(calculatedResults).length
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to calculate and store round results' }, { status: 500 });
    }
}

/**
 * Calculate current round results by calling the existing results system
 */
async function calculateCurrentRoundResults(round) {
    try {
        const results = {};
        
        for (const userId of Object.keys(USER_NAMES)) {
            try {
                const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
                
                // Get team score (which includes dead certs)
                const roundResultsResponse = await fetch(`${baseUrl}/api/round-results?round=${round}&userId=${userId}`);
                let teamScore = 0;
                if (roundResultsResponse.ok) {
                    const userData = await roundResultsResponse.json();
                    teamScore = userData.total || 0; // This is the total score including dead certs
                }

                // Get dead cert score separately
                const tippingResultsResponse = await fetch(`${baseUrl}/api/tipping-results?round=${round}&userId=${userId}`);
                let deadCertScore = 0;
                if (tippingResultsResponse.ok) {
                    const tippingData = await tippingResultsResponse.json();
                    deadCertScore = tippingData.deadCertScore || 0;
                }

                // Calculate actual team score (total - dead certs)
                const actualTeamScore = teamScore - deadCertScore;

                results[userId] = {
                    teamScore: actualTeamScore,
                    deadCertScore: deadCertScore,
                    total: teamScore // This is the combined total
                };
                console.log(`Calculated scores for user ${userId} round ${round}: Team: ${actualTeamScore}, Certs: ${deadCertScore}, Total: ${teamScore}`);

            } catch (error) {
                console.error(`Error getting results for user ${userId}:`, error);
                results[userId] = { teamScore: 0, deadCertScore: 0, total: 0 };
            }
        }
        
        console.log(`Final calculated results for round ${round}:`, results);
        return results;
        
    } catch (error) {
        console.error('Error calculating round results:', error);
        return {};
    }
}

/**
 * DELETE handler to remove stored round results
 */
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        // Delete the round results
        const deleteResult = await db.collection(`${CURRENT_YEAR}_round_results`)
            .deleteOne({ round: round });
        
        // Also clear the cached ladder
        await db.collection(`${CURRENT_YEAR}_ladder`).deleteOne({ round: round });
        
        return Response.json({ 
            success: true, 
            message: `Deleted results for round ${round}`,
            deleted: deleteResult.deletedCount > 0
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to delete round results' }, { status: 500 });
    }
}
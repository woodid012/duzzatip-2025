// src/app/api/final-totals/route.js

import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

/**
 * GET handler - Returns the Final Total values stored by the results page
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        const userId = searchParams.get('userId');

        if (!round) {
            return Response.json({ error: 'Round is required' }, { status: 400 });
        }

        const { db } = await connectToDatabase();
        
        if (userId) {
            // Get Final Total for specific user
            const result = await db.collection(`${CURRENT_YEAR}_final_totals`)
                .findOne({ round: round, userId: userId });
            
            return Response.json({
                userId,
                round,
                finalTotal: result?.finalTotal || 0,
                lastUpdated: result?.lastUpdated || null
            });
        } else {
            // Get Final Totals for all users in this round
            const results = await db.collection(`${CURRENT_YEAR}_final_totals`)
                .find({ round: round })
                .toArray();
            
            const finalTotals = {};
            results.forEach(result => {
                finalTotals[result.userId] = result.finalTotal || 0;
            });
            
            // Ensure all users have a value (default to 0 if missing)
            Object.keys(USER_NAMES).forEach(userId => {
                if (finalTotals[userId] === undefined) {
                    finalTotals[userId] = 0;
                }
            });
            
            return Response.json({
                round,
                finalTotals,
                lastUpdated: results[0]?.lastUpdated || null
            });
        }

    } catch (error) {
        console.error('API Error in GET /api/final-totals:', error);
        return Response.json({ error: 'Failed to get final totals' }, { status: 500 });
    }
}

/**
 * POST handler - Stores Final Total values from the results page
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, userId, finalTotal, allFinalTotals } = data;

        if (!round) {
            return Response.json({ error: 'Round is required' }, { status: 400 });
        }

        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_final_totals`);
        const lastUpdated = new Date();

        if (userId && finalTotal !== undefined) {
            // Store Final Total for single user
            await collection.updateOne(
                { round: round, userId: userId },
                { 
                    $set: { 
                        round: round,
                        userId: userId,
                        finalTotal: finalTotal,
                        lastUpdated: lastUpdated,
                        source: 'results_page'
                    } 
                },
                { upsert: true }
            );
            
            console.log(`Stored Final Total for user ${userId} round ${round}: ${finalTotal}`);
            
            return Response.json({ 
                success: true,
                message: `Stored Final Total for user ${userId}`
            });
            
        } else if (allFinalTotals) {
            // Store Final Totals for all users
            const bulkOps = Object.entries(allFinalTotals).map(([userId, finalTotal]) => ({
                updateOne: {
                    filter: { round: round, userId: userId },
                    update: { 
                        $set: { 
                            round: round,
                            userId: userId,
                            finalTotal: finalTotal,
                            lastUpdated: lastUpdated,
                            source: 'results_page'
                        } 
                    },
                    upsert: true
                }
            }));
            
            await collection.bulkWrite(bulkOps);
            
            console.log(`Stored Final Totals for round ${round}:`, allFinalTotals);
            
            return Response.json({ 
                success: true,
                message: `Stored Final Totals for ${Object.keys(allFinalTotals).length} users`
            });
        } else {
            return Response.json({ error: 'Either userId+finalTotal or allFinalTotals is required' }, { status: 400 });
        }

    } catch (error) {
        console.error('API Error in POST /api/final-totals:', error);
        return Response.json({ error: 'Failed to store final totals' }, { status: 500 });
    }
}

/**
 * DELETE handler - Clear stored Final Totals for a round
 */
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        const result = await db.collection(`${CURRENT_YEAR}_final_totals`)
            .deleteMany({ round: round });
        
        return Response.json({ 
            success: true, 
            message: `Cleared ${result.deletedCount} Final Total records for round ${round}`
        });
        
    } catch (error) {
        console.error('API Error in DELETE /api/final-totals:', error);
        return Response.json({ error: 'Failed to clear final totals' }, { status: 500 });
    }
}
import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

/**
 * GET handler for ladder data
 * Retrieves ladder standings for a specific round or calculates them if not available
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 0; // Default to round 0
        
        const { db } = await connectToDatabase();
        
        // Get ladder data from database
        const ladderData = await db.collection(`${CURRENT_YEAR}_ladder`)
            .findOne({ round: round });
        
        // If ladder data exists, return it
        if (ladderData && ladderData.standings) {
            return Response.json(ladderData.standings);
        }
        
        // If we don't have data for this round, return empty response
        // This forces the client-side to calculate the ladder
        return Response.json([]);
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch ladder data' }, { status: 500 });
    }
}

/**
 * POST handler to store ladder data
 * This will be called when:
 * 1. The round advances and we need to store the new standings
 * 2. When an admin recalculates the ladder
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, standings } = data;
        
        if (!round || !Array.isArray(standings) || standings.length === 0) {
            return Response.json(
                { error: 'Invalid data: round and standings array required' }, 
                { status: 400 }
            );
        }
        
        const { db } = await connectToDatabase();
        
        // Update or insert ladder data
        await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    standings: standings,
                    lastUpdated: new Date() 
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
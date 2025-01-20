import { connectToDatabase } from '@/app/lib/mongodb';

export async function GET(request) {
    try {
        // Parse URL parameters
        const { searchParams } = new URL(request.url);
        const year = parseInt(searchParams.get('year')) || 2024;
        const round = parseInt(searchParams.get('round')) || 1;

        // Get cached database connection
        const { db } = await connectToDatabase();

        // Optimized query with projection
        const stats = await db.collection(`${year}_game_results`)
            .find(
                { week: round - 1 },
                { projection: { player_id: 1, statistics: 1, _id: 0 } }
            )
            .toArray();

        const playerStats = {};
        stats.forEach(stat => {
            playerStats[stat.player_id] = stat.statistics;
        });

        return new Response(JSON.stringify({
            year,
            round,
            stats: playerStats
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to fetch player stats'
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            }
        });
    }
}
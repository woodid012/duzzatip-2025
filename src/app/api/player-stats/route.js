import { connectToDatabase } from '@/app/lib/mongodb';

export async function GET(request) {
    try {
        // Parse URL parameters
        const { searchParams } = new URL(request.url);
        const year = parseInt(searchParams.get('year')) || 2024;
        const round = parseInt(searchParams.get('round')) || 1;
        const player_id = searchParams.get('player_id');

        if (!player_id) {
            return Response.json({ 
                error: 'player_id is required' 
            }, { status: 400 });
        }

        // Get cached database connection
        const { db } = await connectToDatabase();

        // Get player stats with optimized projection
        const playerStat = await db.collection(`${year}_game_results`)
            .findOne({ 
                week: round - 1,
                season: year,
                player_id: parseInt(player_id)
            }, {
                projection: {
                    player_id: 1,
                    player_name: 1,
                    team_id: 1,
                    team_name: 1,
                    'statistics.goals': 1,
                    'statistics.behinds': 1,
                    'statistics.disposals': 1,
                    'statistics.kicks': 1,
                    'statistics.handballs': 1,
                    'statistics.marks': 1,
                    'statistics.tackles': 1,
                    'statistics.hitouts': 1,
                    'statistics.clearances': 1,
                    _id: 0
                }
            });

        if (!playerStat) {
            return Response.json({
                year,
                round,
                player_id,
                stats: null
            });
        }

        return Response.json({
            year,
            round,
            player_id,
            stats: {
                player_id: playerStat.player_id,
                player_name: playerStat.player_name,
                team_id: playerStat.team_id,
                team_name: playerStat.team_name,
                goals: playerStat.statistics?.goals || 0,
                behinds: playerStat.statistics?.behinds || 0,
                disposals: playerStat.statistics?.disposals || 0,
                kicks: playerStat.statistics?.kicks || 0,
                handballs: playerStat.statistics?.handballs || 0,
                marks: playerStat.statistics?.marks || 0,
                tackles: playerStat.statistics?.tackles || 0,
                hitouts: playerStat.statistics?.hitouts || 0,
                clearances: playerStat.statistics?.clearances || 0
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({
            error: 'Failed to fetch player stats'
        }, { status: 500 });
    }
}
import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        const playerName = searchParams.get('player_name');

        if (round === null || round === undefined || !playerName) {
            return Response.json({ error: 'Round and player_name are required' }, { status: 400 });
        }

        const { db } = await connectToDatabase();
        
        const playerStats = await db.collection('2024_game_results')
            .findOne({ 
                player_name: playerName,
                round: round,
                year: CURRENT_YEAR
            }, {
                projection: {
                    player_name: 1,
                    team_name: 1,
                    kicks: 1,
                    handballs: 1,
                    goals: 1,
                    behinds: 1,
                    marks: 1,
                    tackles: 1,
                    hitouts: 1,
                    disposals: 1,
                    _id: 0
                }
            });

        if (!playerStats) {
            return Response.json({ 
                player: playerName,
                team: '-',
                kicks: 0,
                handballs: 0,
                goals: 0,
                behinds: 0,
                marks: 0,
                tackles: 0,
                hitouts: 0,
                disposals: 0
            });
        }

        // Calculate disposals from kicks + handballs
        const disposals = playerStats.kicks + playerStats.handballs;
        
        return Response.json({
            ...playerStats,
            disposals
        });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch player stats' }, { status: 500 });
    }
}
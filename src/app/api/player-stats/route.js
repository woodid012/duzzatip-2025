import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        const playerNames = searchParams.get('players'); // Now expects a comma-separated list

        if (round === null || round === undefined || !playerNames) {
            return Response.json({ error: 'Round and players are required' }, { status: 400 });
        }

        const playerNamesList = playerNames.split(',').map(name => name.trim());

        const { db } = await connectToDatabase();
        
        const playerStats = await db.collection('2024_game_results')
            .find({ 
                player_name: { $in: playerNamesList },
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
            }).toArray();

        // Create a map of found players
        const playerStatsMap = playerStats.reduce((acc, stats) => {
            const disposals = stats.kicks + stats.handballs;
            acc[stats.player_name] = {
                ...stats,
                player_name: stats.player_name,  // Ensure player_name is included
                disposals
            };
            return acc;
        }, {});

        // Ensure all requested players have stats (even if not found)
        const result = playerNamesList.reduce((acc, playerName) => {
            acc[playerName] = playerStatsMap[playerName] || {
                player_name: playerName,
                team_name: '-',
                kicks: 0,
                handballs: 0,
                goals: 0,
                behinds: 0,
                marks: 0,
                tackles: 0,
                hitouts: 0,
                disposals: 0
            };
            return acc;
        }, {});

        return Response.json(result);

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch player stats' }, { status: 500 });
    }
}
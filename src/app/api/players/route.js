import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET() {
    try {
        const { db } = await connectToDatabase();

        const players = await db.collection(`${CURRENT_YEAR}_players`)
            .find({}, {
                projection: {
                    player_id: 1,
                    player_name: 1,
                    team_name: 1,
                    _id: 0
                }
            })
            .toArray();
        
        const playersByTeam = players.reduce((acc, player) => {
            if (!acc[player.team_name]) {
                acc[player.team_name] = [];
            }
            acc[player.team_name].push({
                id: player.player_id,
                name: player.player_name,
                teamName: player.team_name
            });
            return acc;
        }, {});

        return Response.json(playersByTeam);
        
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load players' }, { status: 500 });
    }
}
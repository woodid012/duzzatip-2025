import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET() {
    try {
        // Get cached database connection
        const { db } = await connectToDatabase();

        // Get players with optimized projection
        const players = await db.collection(`${CURRENT_YEAR}_players`)
            .find({}, {
                projection: {
                    player_id: 1,
                    player_name: 1,
                    club_id: 1,
                    club_name: 1,
                    _id: 0
                }
            })
            .toArray();
        
        // Group players by team for easier selection
        const playersByTeam = players.reduce((acc, player) => {
            if (!acc[player.club_id]) {
                acc[player.club_id] = [];
            }
            acc[player.club_id].push({
                id: player.player_id,
                name: player.player_name,
                teamId: player.club_id,
                teamName: player.club_name
            });
            return acc;
        }, {});

        return Response.json(playersByTeam);
        
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load players' }, { status: 500 });
    }
}
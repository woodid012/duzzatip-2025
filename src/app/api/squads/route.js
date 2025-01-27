import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET() {
    try {
        const { db } = await connectToDatabase();

        const squads = await db.collection(`${CURRENT_YEAR}_squads`)
            .find({ Active: 1 }, {
                projection: {
                    user_id: 1,
                    player_name: 1,
                    team: 1,
                    _id: 0
                }
            })
            .toArray();
        
        const users = {};
        squads.forEach(player => {
            if (!users[player.user_id]) {
                users[player.user_id] = {
                    userId: player.user_id,
                    players: []
                };
            }
            users[player.user_id].players.push({
                name: player.player_name,
                team: player.team
            });
        });

        return Response.json(users);
        
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load squads' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const updatedSquads = await request.json();
        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_squads`);

        await collection.deleteMany({});

        const documents = Object.entries(updatedSquads).flatMap(([userId, user]) => 
            user.players.map(player => ({
                user_id: parseInt(userId),
                player_name: player.name,
                team: player.team,
                Active: 1
            }))
        );

        await collection.insertMany(documents, { ordered: false });
        return Response.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to save squads' }, { status: 500 });
    }
}
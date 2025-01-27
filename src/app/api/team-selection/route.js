import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = searchParams.get('round');

        if (!round) {
            return Response.json({ error: 'Round is required' }, { status: 400 });
        }

        const { db } = await connectToDatabase();
        const teamSelection = await db.collection(`${CURRENT_YEAR}_team_selection`)
            .find({ 
                Round: parseInt(round),
                Active: 1 
            }, {
                projection: {
                    User: 1,
                    Position: 1,
                    Player_Name: 1,
                    Backup_Position: 1,
                    _id: 0
                }
            })
            .toArray();
        
        const teams = {};
        teamSelection.forEach(selection => {
            if (!teams[selection.User]) {
                teams[selection.User] = {};
            }
            
            teams[selection.User][selection.Position] = {
                player_name: selection.Player_Name,
                position: selection.Position,
                ...(selection.Position === 'Bench' && selection.Backup_Position 
                    ? { backup_position: selection.Backup_Position } 
                    : {})
            };
        });

        return Response.json(teams);
        
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load team selection' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const { round, team_selection } = await request.json();
        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_team_selection`);

        await collection.deleteMany({ Round: parseInt(round) });

        const documents = Object.entries(team_selection).flatMap(([userId, positions]) => 
            Object.entries(positions)
                .filter(([_, data]) => data && data.player_name)
                .map(([position, data]) => ({
                    User: parseInt(userId),
                    Round: parseInt(round),
                    Position: position,
                    Player_Name: data.player_name,
                    ...(position === 'Bench' && data.backup_position 
                        ? { Backup_Position: data.backup_position } 
                        : {}),
                    Active: 1
                }))
        );

        if (documents.length > 0) {
            await collection.insertMany(documents, { ordered: false });
        }
        return Response.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to save team selection' }, { status: 500 });
    }
}
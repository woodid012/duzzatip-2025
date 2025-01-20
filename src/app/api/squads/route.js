import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET() {
    try {
        // Get cached database connection
        const { db } = await connectToDatabase();

        // Get squads with optimized projection
        const squads = await db.collection(`${CURRENT_YEAR}_squads`)
            .find({}, {
                projection: {
                    Team_ID: 1,
                    Team_Name: 1,
                    Player_ID: 1,
                    Player_Name: 1,
                    Draft_Pick: 1,
                    _id: 0
                }
            })
            .toArray();
        
        // Group players by team
        const teams = {};
        squads.forEach(player => {
            if (!teams[player.Team_ID]) {
                teams[player.Team_ID] = {
                    teamName: player.Team_Name,
                    players: []
                };
            }
            teams[player.Team_ID].players.push({
                id: player.Player_ID,
                name: player.Player_Name,
                draftPick: player.Draft_Pick,
            });
        });

        return Response.json(teams);
        
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load squads' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const updatedSquads = await request.json();
        
        // Get cached database connection
        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_squads`);

        // Clear existing data
        await collection.deleteMany({});

        // Prepare new documents
        const documents = Object.entries(updatedSquads).flatMap(([teamId, team]) => 
            team.players.map(player => ({
                Team_ID: parseInt(teamId),
                Team_Name: team.teamName,
                Player_ID: player.id,
                Player_Name: player.name,
                Draft_Pick: player.draftPick,
                Active: new Date().toISOString()
            }))
        );

        // Insert new data with ordered: false for better performance
        await collection.insertMany(documents, { ordered: false });

        return Response.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to save squads' }, { status: 500 });
    }
}
import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET(request) {
    try {
        // Extract round from query params
        const { searchParams } = new URL(request.url);
        const round = searchParams.get('round');
        const year = searchParams.get('year') || CURRENT_YEAR;

        if (!round) {
            return Response.json({ error: 'Round is required' }, { status: 400 });
        }

        // Get cached database connection
        const { db } = await connectToDatabase();
        const collection = db.collection(`${year}_team_selection`);

        // Fetch team selection for the specific round with optimized projection
        const teamSelectionDocs = await collection.find({ 
            Round: parseInt(round) 
        }, {
            projection: {
                User: 1,
                Position: 1,
                Player_ID: 1,
                Player_Name: 1,
                Backup_Position: 1,
                _id: 0
            }
        }).toArray();

        // Transform docs into the expected client-side format
        const teamSelection = {};
        teamSelectionDocs.forEach(doc => {
            const { User, Position, Player_ID, Player_Name, Backup_Position } = doc;

            if (!teamSelection[User]) {
                teamSelection[User] = {};
            }

            const playerEntry = {
                player_id: Player_ID,
                player_name: Player_Name,
                position: Position
            };

            // Add backup position for Bench if exists
            if (Position === 'Bench' && Backup_Position) {
                playerEntry.backup_position = Backup_Position;
            }

            teamSelection[User][Position] = playerEntry;
        });

        return Response.json(teamSelection);
        
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load team selection' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        // Parse the incoming request body
        const { year, round, team_selection } = await request.json();

        if (!year || !round || !team_selection) {
            return Response.json({ error: 'Year, round, and team selection are required' }, { status: 400 });
        }

        // Get cached database connection
        const { db } = await connectToDatabase();
        const collection = db.collection(`${year}_team_selection`);

        // Clear existing entries for this round
        await collection.deleteMany({ 
            Round: round 
        });

        // Prepare new documents
        const documents = Object.entries(team_selection).flatMap(([user, positions]) => 
            Object.entries(positions).map(([position, playerData]) => ({
                Year: year,
                Round: round,
                User: parseInt(user),
                Position: position,
                Player_ID: playerData.player_id || null,
                Player_Name: playerData.player_name || null,
                // Only add Backup_Position for Bench position
                ...(position === 'Bench' && playerData.backup_position 
                    ? { Backup_Position: playerData.backup_position } 
                    : {})
            }))
        );

        // Insert new data with better performance options
        if (documents.length > 0) {
            await collection.insertMany(documents, { 
                ordered: false, // Better performance for bulk inserts
                writeConcern: { w: 1 } // Minimal write concern for speed
            });
        }

        return Response.json({ 
            success: true, 
            message: 'Team selection saved successfully' 
        });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to save team selection' }, { status: 500 });
    }
}
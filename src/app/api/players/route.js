import { MongoClient } from 'mongodb';
import { CURRENT_YEAR } from '@/app/lib/config';  // Fixed path using @ alias

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

export async function GET() {
  try {
    const client = await MongoClient.connect(MONGODB_URI);
    const db = client.db('afl_database');
    const players = await db.collection(`${CURRENT_YEAR}_players`).find({}).toArray();
    
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

    await client.close();
    return Response.json(playersByTeam);
    
  } catch (error) {
    console.error('Database Error:', error);
    return Response.json({ error: 'Failed to load players' }, { status: 500 });
  }
}
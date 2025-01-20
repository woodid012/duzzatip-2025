import { MongoClient } from 'mongodb';
import {CURRENT_YEAR } from '@/app/lib/constants';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

export async function GET() {
  try {
    const client = await MongoClient.connect(MONGODB_URI);
    const db = client.db('afl_database');
    const squads = await db.collection(`${CURRENT_YEAR}_squads`).find({}).toArray();
    
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

    await client.close();
    return Response.json(teams);
    
  } catch (error) {
    console.error('Database Error:', error);
    return Response.json({ error: 'Failed to load squads' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const updatedSquads = await request.json();
    const client = await MongoClient.connect(MONGODB_URI);
    const db = client.db('afl_database');
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

    // Insert new data
    await collection.insertMany(documents);
    await client.close();

    return Response.json({ success: true });
  } catch (error) {
    console.error('Database Error:', error);
    return Response.json({ error: 'Failed to save squads' }, { status: 500 });
  }
}
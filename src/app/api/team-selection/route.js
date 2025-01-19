import { MongoClient } from 'mongodb';
import { CURRENT_YEAR } from '@/app/lib/config';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

export async function GET(request) {
  try {
    // Get round from search params
    const { searchParams } = new URL(request.url);
    const round = parseInt(searchParams.get('round'));

    if (!round) {
      return Response.json({ error: 'Round parameter is required' }, { status: 400 });
    }

    const client = await MongoClient.connect(MONGODB_URI);
    const db = client.db('afl_database');
    const selections = await db.collection(`${CURRENT_YEAR}_team_selection`)
      .find({ round })
      .sort({ team: 1, position: 1 })
      .toArray();

    await client.close();
    return Response.json(selections);
  } catch (error) {
    console.error('Database Error:', error);
    return Response.json({ error: 'Failed to load team selections' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const selection = await request.json();
    const client = await MongoClient.connect(MONGODB_URI);
    const db = client.db('afl_database');
    const collection = db.collection(`${CURRENT_YEAR}_team_selection`);

    // Validate required fields
    const requiredFields = ['round', 'team', 'position', 'player_id', 'player_name', 'timestamp'];
    for (const field of requiredFields) {
      if (!selection[field]) {
        await client.close();
        return Response.json({ error: `Missing required field: ${field}` }, { status: 400 });
      }
    }

    // Prepare the document to insert/update
    const document = {
      round: selection.round,
      team: selection.team,
      position: selection.position,
      player_id: selection.player_id,
      player_name: selection.player_name,
      timestamp: selection.timestamp
    };

    // Add bench_position if it exists and position is BENCH
    if (selection.position === 'BENCH' && selection.bench_position) {
      document.bench_position = selection.bench_position;
    }

    // Update or insert the selection
    const result = await collection.updateOne(
      {
        round: selection.round,
        team: selection.team,
        position: selection.position
      },
      {
        $set: document
      },
      { upsert: true }
    );

    await client.close();
    return Response.json({ success: true, timestamp: selection.timestamp });
  } catch (error) {
    console.error('Database Error:', error);
    return Response.json({ error: 'Failed to save team selection' }, { status: 500 });
  }
}
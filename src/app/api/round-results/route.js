// app/api/player-stats/route.js
import { MongoClient, ServerApiVersion } from 'mongodb';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

export async function GET(request) {
    try {
        // Parse URL parameters
        const { searchParams } = new URL(request.url);
        const year = parseInt(searchParams.get('year')) || 2024;
        const round = parseInt(searchParams.get('round')) || 1;

        // Connect to MongoDB
        const client = new MongoClient(MONGODB_URI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await client.connect();
        const db = client.db('afl_database');

        // Get player stats from the game_results collection
        // Note: week = round - 1 based on your Python script
        const stats = await db.collection(`${year}_game_results`)
            .find({ week: round - 1 })
            .toArray();

        // Transform stats into a player-indexed object
        const playerStats = {};
        stats.forEach(stat => {
            playerStats[stat.player_id] = stat.statistics;
        });

        await client.close();

        return new Response(JSON.stringify({
            year,
            round,
            stats: playerStats
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to fetch player stats'
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            }
        });
    }
}
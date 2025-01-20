// app/api/player-stats/route.js
import { MongoClient, ServerApiVersion } from 'mongodb';
import { promises as fs } from 'fs';
import path from 'path';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";
const CACHE_DIR = path.join(process.cwd(), 'public', 'cache');

// Helper function to get cache file path
const getCacheFilePath = (year, round) => {
    return path.join(CACHE_DIR, `stats_${year}_${round}.json`);
};

// Helper function to read cache
async function readCache(year, round) {
    try {
        const filePath = getCacheFilePath(year, round);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

// Helper function to write cache
async function writeCache(year, round, data) {
    try {
        // Check if we have write permissions
        try {
            // Ensure cache directory exists
            await fs.mkdir(CACHE_DIR, { recursive: true });
            // Test write permissions with a temp file
            const testPath = path.join(CACHE_DIR, '.write-test');
            await fs.writeFile(testPath, 'test');
            await fs.unlink(testPath);
        } catch (permError) {
            console.warn('Cache directory not writable:', permError);
            return false;
        }

        const filePath = getCacheFilePath(year, round);
        await fs.writeFile(filePath, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Cache write error:', error);
        return false;
    }
}

export async function GET(request) {
    try {
        // Parse URL parameters
        const { searchParams } = new URL(request.url);
        const year = parseInt(searchParams.get('year')) || 2024;
        const round = parseInt(searchParams.get('round')) || 1;

        // Try to get cached data first
        const cachedData = await readCache(year, round);
        if (cachedData) {
            return new Response(JSON.stringify(cachedData), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Cache': 'HIT'
                }
            });
        }

        // If no cache, fetch from MongoDB
        const client = new MongoClient(MONGODB_URI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        await client.connect();
        const db = client.db('afl_database');

        const stats = await db.collection(`${year}_game_results`)
            .find({ week: round - 1 })
            .toArray();

        const playerStats = {};
        stats.forEach(stat => {
            playerStats[stat.player_id] = stat.statistics;
        });

        await client.close();

        const responseData = {
            year,
            round,
            stats: playerStats
        };

        // Write to cache
        await writeCache(year, round, responseData);

        return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'X-Cache': 'MISS'
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
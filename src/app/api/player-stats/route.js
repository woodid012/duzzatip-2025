// app/api/player-stats/route.js
import { MongoClient } from 'mongodb';
import { promises as fs } from 'fs';
import path from 'path';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";
const CACHE_DIR = path.join(process.cwd(), 'public', 'cache');

// Helper function to get cache file path
const getCacheFilePath = (year, round, player_id) => {
    return path.join(CACHE_DIR, `stats_${year}_${round}_${player_id}.json`);
};

// Helper function to read cache
async function readCache(year, round, player_id) {
    try {
        const filePath = getCacheFilePath(year, round, player_id);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

// Helper function to write cache
async function writeCache(year, round, player_id, data) {
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

        const filePath = getCacheFilePath(year, round, player_id);
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
        const player_id = searchParams.get('player_id');

        if (!player_id) {
            return Response.json({ 
                error: 'player_id is required' 
            }, { status: 400 });
        }

        // Try to get cached data first
        const cachedData = await readCache(year, round, player_id);
        if (cachedData) {
            return Response.json(cachedData, {
                headers: {
                    'X-Cache': 'HIT'
                }
            });
        }

        // Connect to MongoDB
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const db = client.db('afl_database');

        // Get player stats from the game_results collection
        const playerStat = await db.collection(`${year}_game_results`)
            .findOne({ 
                week: round - 1,
                season: year,
                player_id: parseInt(player_id)
            });

        await client.close();

        if (!playerStat) {
            const responseData = {
                year,
                round,
                player_id,
                stats: null
            };
            await writeCache(year, round, player_id, responseData);
            return Response.json(responseData);
        }

        const responseData = {
            year,
            round,
            player_id,
            stats: {
                player_id: playerStat.player_id,
                player_name: playerStat.player_name,
                team_id: playerStat.team_id,
                team_name: playerStat.team_name,
                goals: playerStat.statistics.goals || 0,
                behinds: playerStat.statistics.behinds || 0,
                disposals: playerStat.statistics.disposals || 0,
                kicks: playerStat.statistics.kicks || 0,
                handballs: playerStat.statistics.handballs || 0,
                marks: playerStat.statistics.marks || 0,
                tackles: playerStat.statistics.tackles || 0,
                hitouts: playerStat.statistics.hitouts || 0,
                clearances: playerStat.statistics.clearances || 0
            }
        };

        // Write to cache
        await writeCache(year, round, player_id, responseData);

        return Response.json(responseData, {
            headers: {
                'X-Cache': 'MISS'
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({
            error: 'Failed to fetch player stats'
        }, { status: 500 });
    }
}
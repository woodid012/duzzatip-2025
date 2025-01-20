import { MongoClient } from 'mongodb';
import { promises as fs } from 'fs';
import path from 'path';
import {CURRENT_YEAR } from '@/app/lib/constants';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";
const CACHE_DIR = path.join(process.cwd(), 'public', 'cache');

// Helper function to get cache file path
const getCacheFilePath = (year, round) => {
    return path.join(CACHE_DIR, `team_selection_${year}_${round}.json`);
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

// Helper function to invalidate cache
async function invalidateCache(year, round) {
    try {
        const filePath = getCacheFilePath(year, round);
        await fs.unlink(filePath);
        return true;
    } catch (error) {
        console.warn('Cache invalidation error:', error);
        return false;
    }
}

export async function GET(request) {
    try {
        // Extract round from query params
        const { searchParams } = new URL(request.url);
        const round = searchParams.get('round');
        const year = searchParams.get('year') || CURRENT_YEAR;

        if (!round) {
            return Response.json({ error: 'Round is required' }, { status: 400 });
        }

        // Try to get cached data first
        const cachedData = await readCache(year, round);
        if (cachedData) {
            return Response.json(cachedData, {
                headers: {
                    'X-Cache': 'HIT'
                }
            });
        }

        const client = await MongoClient.connect(MONGODB_URI);
        const db = client.db('afl_database');
        const collection = db.collection(`${year}_team_selection`);

        // Fetch team selection for the specific round
        const teamSelectionDocs = await collection.find({ 
            Round: parseInt(round) 
        }).toArray();

        await client.close();

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

        // Write to cache
        await writeCache(year, round, teamSelection);

        return Response.json(teamSelection, {
            headers: {
                'X-Cache': 'MISS'
            }
        });
        
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

        const client = await MongoClient.connect(MONGODB_URI);
        const db = client.db('afl_database');
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

        // Insert new data
        if (documents.length > 0) {
            await collection.insertMany(documents);
        }

        // Invalidate cache for this round
        await invalidateCache(year, round);

        await client.close();

        return Response.json({ 
            success: true, 
            message: 'Team selection saved successfully' 
        });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to save team selection' }, { status: 500 });
    }
}
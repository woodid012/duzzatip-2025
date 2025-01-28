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
        
        // Use aggregation pipeline for better performance
        const teamSelection = await db.collection(`${CURRENT_YEAR}_team_selection`)
            .aggregate([
                { 
                    $match: { 
                        Round: parseInt(round),
                        Active: 1 
                    }
                },
                {
                    $group: {
                        _id: '$User',
                        positions: {
                            $push: {
                                position: '$Position',
                                player_name: '$Player_Name',
                                backup_position: '$Backup_Position'
                            }
                        }
                    }
                }
            ]).toArray();
        
        const teams = {};
        teamSelection.forEach(user => {
            teams[user._id] = {};
            user.positions.forEach(pos => {
                teams[user._id][pos.position] = {
                    player_name: pos.player_name,
                    position: pos.position,
                    ...(pos.position === 'Bench' && pos.backup_position 
                        ? { backup_position: pos.backup_position } 
                        : {})
                };
            });
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

        // Create bulk operations
        const bulkOps = [];

        // First, mark all existing records for this round as inactive
        bulkOps.push({
            updateMany: {
                filter: { Round: parseInt(round) },
                update: { $set: { Active: 0 } }
            }
        });

        // Then, insert or update new records
        Object.entries(team_selection).forEach(([userId, positions]) => {
            Object.entries(positions).forEach(([position, data]) => {
                if (data && data.player_name) {
                    bulkOps.push({
                        updateOne: {
                            filter: {
                                User: parseInt(userId),
                                Round: parseInt(round),
                                Position: position
                            },
                            update: {
                                $set: {
                                    Player_Name: data.player_name,
                                    ...(position === 'Bench' && data.backup_position 
                                        ? { Backup_Position: data.backup_position } 
                                        : {}),
                                    Active: 1
                                }
                            },
                            upsert: true
                        }
                    });
                }
            });
        });

        // Execute all operations in a single batch
        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps, { ordered: false });
        }

        return Response.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to save team selection' }, { status: 500 });
    }
}
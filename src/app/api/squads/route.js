import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET() {
    try {
        const { db } = await connectToDatabase();

        // Use aggregation pipeline for better performance
        const squads = await db.collection(`${CURRENT_YEAR}_squads`)
            .aggregate([
                { 
                    $match: { Active: 1 }
                },
                {
                    $group: {
                        _id: '$user_id',
                        players: {
                            $push: {
                                name: '$player_name',
                                team: '$team'
                            }
                        }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        userId: '$_id',
                        players: 1
                    }
                }
            ]).toArray();

        // Convert array to object with userId as key
        const users = squads.reduce((acc, squad) => {
            acc[squad.userId] = {
                userId: squad.userId,
                players: squad.players
            };
            return acc;
        }, {});

        return Response.json(users);
        
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load squads' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const updatedSquads = await request.json();
        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_squads`);

        // Create bulk operations
        const bulkOps = [];

        // First, mark all existing records as inactive
        bulkOps.push({
            updateMany: {
                filter: {},
                update: { $set: { Active: 0 } }
            }
        });

        // Then, insert or update new records
        Object.entries(updatedSquads).forEach(([userId, user]) => {
            user.players.forEach(player => {
                bulkOps.push({
                    updateOne: {
                        filter: {
                            user_id: parseInt(userId),
                            player_name: player.name,
                            team: player.team
                        },
                        update: {
                            $set: {
                                user_id: parseInt(userId),
                                player_name: player.name,
                                team: player.team,
                                Active: 1
                            }
                        },
                        upsert: true
                    }
                });
            });
        });

        // Execute all operations in a single batch
        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps, { ordered: false });
        }

        return Response.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to save squads' }, { status: 500 });
    }
}
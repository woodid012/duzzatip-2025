// src/app/api/squads/route.js
import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET() {
    try {
        const { db } = await connectToDatabase();

        // Get current squads with acquisition information
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
                                team: '$team',
                                acquisition_type: '$acquisition_type',
                                acquisition_date: '$acquisition_date'
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

// Keep the existing POST method mostly the same, but add acquisition tracking
export async function POST(request) {
    try {
        const { updatedSquads, acquisition_type = 'initial' } = await request.json();
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
                                Active: 1,
                                acquisition_type: player.acquisition_type || acquisition_type,
                                acquisition_date: player.acquisition_date || new Date()
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

// Updated endpoint for modifying squads (trades, mid-season drafts, delist)
export async function PATCH(request) {
    try {
        const { userId, type, players_in, players_out, tradeWithUserId } = await request.json();
        
        if (!userId || !type) {
            return Response.json({ error: 'Missing required parameters' }, { status: 400 });
        }
        
        
        
        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_squads`);

        const bulkOps = [];

        // Handle different modification types
        switch (type) {
            case 'initial':
                // Add new players from initial draft
                if (players_in && players_in.length > 0) {
                    
                    players_in.forEach(player => {
                        if (!player.name) return;
                        
                        bulkOps.push({
                            updateOne: {
                                filter: {
                                    user_id: parseInt(userId),
                                    player_name: player.name,
                                    team: player.team || ''
                                },
                                update: {
                                    $set: {
                                        user_id: parseInt(userId),
                                        player_name: player.name,
                                        team: player.team || '',
                                        Active: 1,
                                        acquisition_type: 'initial',
                                        acquisition_date: new Date()
                                    }
                                },
                                upsert: true
                            }
                        });
                    });
                }
                break;
                
            case 'trade':
                // Remove players that are traded out
                if (players_out && players_out.length > 0) {
                    bulkOps.push({
                        updateMany: {
                            filter: { 
                                user_id: parseInt(userId),
                                player_name: { $in: players_out.map(p => typeof p === 'string' ? p : p.name) },
                                Active: 1
                            },
                            update: { 
                                $set: { 
                                    Active: 0,
                                    deactivation_type: 'trade',
                                    deactivation_date: new Date()
                                } 
                            }
                        }
                    });
                }
                
                // Add players that are traded in
                if (players_in && players_in.length > 0) {
                    players_in.forEach(player => {
                        const playerName = typeof player === 'string' ? player : player.name;
                        const playerTeam = typeof player === 'string' ? '' : (player.team || '');
                        
                        bulkOps.push({
                            updateOne: {
                                filter: {
                                    user_id: parseInt(userId),
                                    player_name: playerName,
                                    team: playerTeam
                                },
                                update: {
                                    $set: {
                                        user_id: parseInt(userId),
                                        player_name: playerName,
                                        team: playerTeam,
                                        Active: 1,
                                        acquisition_type: 'trade',
                                        acquisition_date: new Date()
                                    }
                                },
                                upsert: true
                            }
                        });
                    });
                }
                break;

            case 'midseason_draft_1':
            case 'midseason_draft_2':
                // Add new players from mid-season draft
                if (players_in && players_in.length > 0) {
                    players_in.forEach(player => {
                        const playerName = typeof player === 'string' ? player : player.name;
                        const playerTeam = typeof player === 'string' ? '' : (player.team || '');
                        
                        bulkOps.push({
                            updateOne: {
                                filter: {
                                    user_id: parseInt(userId),
                                    player_name: playerName,
                                    team: playerTeam
                                },
                                update: {
                                    $set: {
                                        user_id: parseInt(userId),
                                        player_name: playerName,
                                        team: playerTeam,
                                        Active: 1,
                                        acquisition_type: type,
                                        acquisition_date: new Date()
                                    }
                                },
                                upsert: true
                            }
                        });
                    });
                }
                break;

            case 'delist':
                // Remove players that are delisted
                if (players_out && players_out.length > 0) {
                    // Extract player names, handling both string and object formats
                    const playerNames = players_out.map(player => 
                        typeof player === 'string' ? player : player.name
                    );
                    
                    bulkOps.push({
                        updateMany: {
                            filter: { 
                                user_id: parseInt(userId),
                                player_name: { $in: playerNames },
                                Active: 1
                            },
                            update: { 
                                $set: { 
                                    Active: 0,
                                    deactivation_type: 'delist',
                                    deactivation_date: new Date()
                                } 
                            }
                        }
                    });
                }
                break;
                
            default:
                return Response.json({ error: `Unknown transaction type: ${type}` }, { status: 400 });
        }

        // Execute all operations
        if (bulkOps.length > 0) {
            
            await collection.bulkWrite(bulkOps, { ordered: false });
        } else {
            console.warn('No database operations to perform');
        }

        // Process players for transaction history
        const players_in_names = players_in ? players_in.map(player => 
            typeof player === 'string' ? player : player.name
        ) : [];
        
        const players_out_names = players_out ? players_out.map(player => 
            typeof player === 'string' ? player : player.name
        ) : [];

        // Log the transaction in a separate collection for history
        const transactionData = {
            user_id: parseInt(userId),
            type: type,
            players_in: players_in_names,
            players_out: players_out_names,
            transaction_date: new Date(),
            Active: 1
        };
        
        // Add trade partner info if this is a trade
        if (type === 'trade' && tradeWithUserId) {
            transactionData.trade_with_user_id = parseInt(tradeWithUserId);
        }
        
        await db.collection(`${CURRENT_YEAR}_squad_transactions`).insertOne(transactionData);
        
        
        return Response.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to modify squad' }, { status: 500 });
    }
}

// Updated endpoint to get squad history with linked trade information
export async function OPTIONS(request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return Response.json({ error: 'userId is required' }, { status: 400 });
        }

        const { db } = await connectToDatabase();
        
        // Get the full transaction history for this user
        const transactions = await db.collection(`${CURRENT_YEAR}_squad_transactions`)
            .find({ 
                user_id: parseInt(userId),
                Active: 1 
            })
            .sort({ transaction_date: 1 })
            .toArray();

        // Get the current squad with acquisition details
        const currentSquad = await db.collection(`${CURRENT_YEAR}_squads`)
            .find({
                user_id: parseInt(userId),
                Active: 1
            })
            .toArray();

        // Get related trade transactions (where this user is the trade partner)
        const relatedTrades = await db.collection(`${CURRENT_YEAR}_squad_transactions`)
            .find({ 
                trade_with_user_id: parseInt(userId),
                type: 'trade',
                Active: 1 
            })
            .toArray();
            
        // Combine regular transactions with related trades
        const allTransactions = [...transactions];
        
        // Process related trades to format them correctly from this user's perspective
        relatedTrades.forEach(trade => {
            // Add as a related trade with players_in/out swapped (since this user is the partner)
            allTransactions.push({
                ...trade,
                is_related_trade: true,
                // Swap players in/out since this user is the trade partner
                players_in: trade.players_out,
                players_out: trade.players_in,
                trade_with_user_id: trade.user_id, // Set trade partner to the user who initiated
                user_id: parseInt(userId) // Set user to current user
            });
        });
        
        // Sort all transactions by date
        allTransactions.sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));

        // Break down squad by acquisition type
        const squadByType = {
            initial: currentSquad.filter(p => p.acquisition_type === 'initial' || !p.acquisition_type),
            trade: currentSquad.filter(p => p.acquisition_type === 'trade'),
            midseason_draft_1: currentSquad.filter(p => p.acquisition_type === 'midseason_draft_1'),
            midseason_draft_2: currentSquad.filter(p => p.acquisition_type === 'midseason_draft_2')
        };

        return Response.json({
            currentSquad,
            squadByType,
            transactions: allTransactions || []
        });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load squad history' }, { status: 500 });
    }
}
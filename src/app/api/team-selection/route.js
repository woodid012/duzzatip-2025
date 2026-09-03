import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { parseYearParam, blockWritesForPastYear } from '@/app/lib/apiUtils';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { filterWritablePositions } from '@/app/lib/rollingLockout';
import { canSeeOthers, submittedOnTimeIds } from '@/app/lib/submissionStatus';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = searchParams.get('round');
        const year = parseYearParam(searchParams);

        if (!round) {
            return Response.json({ error: 'Round is required' }, { status: 400 });
        }

        const { db } = await connectToDatabase();

        // Use aggregation pipeline for better performance
        const teamSelection = await db.collection(`${year}_team_selection`)
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
                                backup_position: '$Backup_Position',
                                last_updated: '$Last_Updated' // Include the Last_Updated field
                            }
                        },
                        lastUpdated: { $max: '$Last_Updated' } // Get the most recent update timestamp
                    }
                }
            ]).toArray();
        
        const teams = {};
        teamSelection.forEach(user => {
            teams[user._id] = {};
            
            // Store the most recent update timestamp
            teams[user._id]._lastUpdated = user.lastUpdated;
            
            user.positions.forEach(pos => {
                teams[user._id][pos.position] = {
                    player_name: pos.player_name,
                    position: pos.position,
                    ...(pos.position === 'Bench' && pos.backup_position 
                        ? { backup_position: pos.backup_position } 
                        : {}),
                    last_updated: pos.last_updated
                };
            });
        });

        // Privacy: you always get your own team. Everyone else's opens up at the
        // first bounce — but only to a viewer who got their own team in before
        // it. A viewer still filling slots under the rolling window sees only
        // their own, or the concession would let them build a team around what
        // everyone else picked.
        const sess = getSessionUser(request);
        const isAdmin = sess && sess.uid === ADMIN_UID;
        const ownId = sess && sess.uid ? Number(sess.uid) : null;
        const canSee = await canSeeOthers(db, 'team', parseInt(round), { isAdmin, viewerId: ownId }, year);
        if (!canSee) {
            const filtered = {};
            for (const k of Object.keys(teams)) {
                if (ownId !== null && Number(k) === ownId) filtered[k] = teams[k];
            }
            return Response.json(filtered);
        }

        return Response.json(teams);

    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to load team selection' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const { round, team_selection, year: bodyYear } = await request.json();

        // Block writes for past years
        const blocked = blockWritesForPastYear(bodyYear || CURRENT_YEAR);
        if (blocked) return blocked;

        // Write protection: a logged-in player may only save their OWN team —
        // drop any other users' entries from the payload. Admin saves anyone's.
        const sess = getSessionUser(request);
        const isAdmin = sess && sess.uid === ADMIN_UID;
        let writable = team_selection;
        if (!isAdmin) {
            if (!sess) {
                return Response.json({ error: 'Not authorised' }, { status: 403 });
            }
            const own = String(sess.uid);
            writable = Object.fromEntries(
                Object.entries(team_selection).filter(([uid]) => String(uid) === own)
            );
            if (Object.keys(writable).length === 0) {
                return Response.json({ error: 'Not authorised to edit this team' }, { status: 403 });
            }
        }

        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_team_selection`);
        const roundNum = parseInt(round);

        // Lockout, enforced server-side rather than trusted from the client.
        // A player who submitted before the first bounce is locked to their team
        // outright; only a player who missed the deadline gets the rolling
        // window, where each position closes as its own game commences.
        if (!isAdmin) {
            // blockWritesForPastYear above guarantees this is the current season.
            const fixtures = await getAflFixtures(CURRENT_YEAR);
            const userIds = Object.keys(writable).map(uid => parseInt(uid));

            const [squadRows, storedRows, submitters] = await Promise.all([
                db.collection(`${CURRENT_YEAR}_squads`)
                    .find({ user_id: { $in: userIds }, Active: 1 })
                    .toArray(),
                collection
                    .find({ Round: roundNum, User: { $in: userIds }, Active: 1 })
                    .toArray(),
                submittedOnTimeIds(db, 'team', roundNum, CURRENT_YEAR),
            ]);

            // player name -> club, per user
            const clubByUser = {};
            for (const row of squadRows) {
                if (!clubByUser[row.user_id]) clubByUser[row.user_id] = {};
                clubByUser[row.user_id][row.player_name] = row.team;
            }
            // stored selection, per user, keyed by position
            const storedByUser = {};
            for (const row of storedRows) {
                if (!storedByUser[row.User]) storedByUser[row.User] = {};
                storedByUser[row.User][row.Position] = {
                    player_name: row.Player_Name,
                    backup_position: row.Backup_Position,
                };
            }

            const enforced = {};
            let incomingCount = 0;
            let allowedCount = 0;
            for (const [userId, positions] of Object.entries(writable)) {
                const uid = parseInt(userId);
                incomingCount += Object.keys(positions || {}).length;
                const { allowed, rejected } = filterWritablePositions(
                    storedByUser[uid] || {},
                    positions,
                    {
                        fixtures,
                        round: roundNum,
                        clubOf: (name) => clubByUser[uid]?.[name] ?? null,
                        submittedOnTime: submitters.has(uid),
                    }
                );
                if (rejected.length > 0) {
                    console.log(
                        `Rolling lockout: refused ${rejected.length} locked position(s) for user ${uid}, ` +
                        `round ${roundNum} — ${rejected.map(r => `${r.position} (${r.reason})`).join('; ')}`
                    );
                }
                allowedCount += Object.keys(allowed).length;
                if (Object.keys(allowed).length > 0) enforced[userId] = allowed;
            }

            // Only an error when there was something to save and every bit of it
            // was locked out. An empty payload stays a harmless no-op.
            if (incomingCount > 0 && allowedCount === 0) {
                const anySubmitter = Object.keys(writable).some(uid => submitters.has(parseInt(uid)));
                return Response.json(
                    {
                        error: anySubmitter
                            ? 'Your team was submitted before the first bounce, so it is locked for the round'
                            : 'Those positions are locked — their games have already started',
                    },
                    { status: 409 }
                );
            }
            writable = enforced;
        }

        // Create bulk operations array
        const bulkOps = [];

        // For each user that has changes
        Object.entries(writable).forEach(([userId, positions]) => {
            // First, mark the specific positions being updated as inactive
            const positionsToUpdate = Object.keys(positions);
            if (positionsToUpdate.length > 0) {
                bulkOps.push({
                    updateMany: {
                        filter: { 
                            Round: parseInt(round),
                            User: parseInt(userId),
                            Position: { $in: positionsToUpdate }
                        },
                        update: { $set: { Active: 0 } }
                    }
                });

                // Then add the new position records
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
                                        Position: position,
                                        Round: parseInt(round),
                                        User: parseInt(userId),
                                        ...(position === 'Bench' && data.backup_position 
                                            ? { Backup_Position: data.backup_position } 
                                            : {}),
                                        Active: 1,
                                        Last_Updated: new Date()
                                    }
                                },
                                upsert: true
                            }
                        });
                    }
                });
            }
        });

        // Execute all operations in a single batch if there are any
        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps, { ordered: false });
        }

        return Response.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        return Response.json({ error: 'Failed to save team selection' }, { status: 500 });
    }
}
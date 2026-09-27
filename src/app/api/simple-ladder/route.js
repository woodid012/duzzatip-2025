// src/app/api/simple-ladder/route.js

import { connectToDatabase } from '@/app/lib/mongodb';
import { withReadCache } from '@/app/lib/apiUtils';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { tallyLadder, sortLadder } from '@/app/lib/ladderTotals';
import { parseYearParam } from '@/app/lib/apiUtils';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';

/**
 * GET - Retrieve ladder data from stored round results
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const roundParam = searchParams.get('round');
        const upToRound = roundParam !== null ? parseInt(roundParam) : 21;
        const year = parseYearParam(searchParams);

        const { db } = await connectToDatabase();
        
        console.log(`Building ladder up to round ${upToRound}`);

        // Check ALL rounds up to upToRound for stale/missing cached results
        if (upToRound > 0) {
            // Fetch all stored round results and game_results timestamps in bulk
            const allStored = await db.collection(`${year}_simple_round_results`)
                .find({ round: { $lte: upToRound } }, { projection: { round: 1, lastUpdated: 1 } })
                .toArray();
            const storedByRound = {};
            allStored.forEach(r => { storedByRound[r.round] = r.lastUpdated ? new Date(r.lastUpdated) : null; });

            // Newest game_results timestamp per round in ONE aggregation instead
            // of ~21 serial findOne calls. $max on created_at == the prior
            // findOne sort (only refreshGameResults writes created_at). Fail
            // OPEN to the per-round loop so an aggregation error never silently
            // reports "zero rounds stale" (which would serve a stale ladder).
            const newestByRound = {};
            try {
                const agg = await db.collection(`${year}_game_results`).aggregate([
                    { $match: { round: { $gte: 1, $lte: upToRound } } },
                    { $group: { _id: '$round', newest: { $max: '$created_at' } } },
                ]).toArray();
                agg.forEach(g => { newestByRound[g._id] = g.newest ? new Date(g.newest) : null; });
            } catch (aggErr) {
                console.warn('simple-ladder stale-detect aggregation failed, falling back to per-round:', aggErr.message);
                for (let r = 1; r <= upToRound; r++) {
                    const n = await db.collection(`${year}_game_results`)
                        .findOne({ round: r }, { sort: { created_at: -1 }, projection: { created_at: 1 } });
                    newestByRound[r] = n?.created_at ? new Date(n.created_at) : null;
                }
            }

            // Find rounds that have game_results but are missing or stale in simple_round_results
            const roundsToRefresh = [];
            for (let r = 1; r <= upToRound; r++) {
                const cachedAt = storedByRound[r] || null;
                const gameResultsAt = newestByRound[r] || null;
                if (gameResultsAt && (!cachedAt || gameResultsAt > cachedAt)) {
                    roundsToRefresh.push(r);
                }
            }

            if (roundsToRefresh.length > 0) {
                console.log(`Rounds needing refresh: ${roundsToRefresh.join(', ')}`);
                const host = request.headers.get('host');
                const proto = host?.includes('localhost') ? 'http' : 'https';
                const baseUrl = process.env.NEXTAUTH_URL ||
                    (host ? `${proto}://${host}` : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'));

                await Promise.all(roundsToRefresh.map(async (r) => {
                    try {
                        const response = await fetch(`${baseUrl}/api/consolidated-round-results?round=${r}&year=${year}`);
                        if (response.ok) {
                            const data = await response.json();
                            const hasValidData = data.results &&
                                Object.values(data.results).some(result => result.totalScore > 0);

                            // Only persist a snapshot once every game in the round is
                            // complete. Writing an in-progress round here could freeze a
                            // partial tie into the ladder as a phantom draw (the bug this
                            // gate exists to prevent). Incomplete rounds are simply skipped;
                            // they get written on a later load once the round finishes.
                            if (hasValidData && data.allGamesComplete) {
                                const roundData = {};
                                Object.entries(data.results).forEach(([userId, result]) => {
                                    roundData[userId] = {
                                        totalScore: result.totalScore || 0,
                                        playerScore: result.playerScore || 0,
                                        deadCertScore: result.deadCertScore || 0,
                                        matchResult: result.matchResult || null,
                                        opponent: result.opponent || null,
                                        hasStar: result.hasStar || false,
                                        hasCrab: result.hasCrab || false
                                    };
                                });

                                await db.collection(`${year}_simple_round_results`).updateOne(
                                    { round: r },
                                    { $set: { round: r, results: roundData, lastUpdated: new Date() } },
                                    { upsert: true }
                                );
                                console.log(`Auto-refreshed round ${r} with ${Object.keys(roundData).length} results`);
                            }
                        }
                    } catch (err) {
                        console.warn(`Auto-refresh failed for round ${r}:`, err.message);
                    }
                }));
            }
        }

        // Get stored round results from database
        const maxRound = Math.min(upToRound, 21); // Cap at round 21 for regular season

        // One read for every round rather than one round trip per round: this
        // loop used to await a findOne 21 times in series on every request.
        const storedByRound = new Map(
            (await db.collection(`${year}_simple_round_results`)
                .find({ round: { $gte: 1, $lte: maxRound } })
                .toArray())
                .map(doc => [doc.round, doc])
        );

        const rounds = [];
        for (let round = 1; round <= maxRound; round++) {
            const storedResults = storedByRound.get(round);
            
            if (!storedResults || !storedResults.results) {
                console.log(`No stored results for round ${round}`);
                continue;
            }

            const scores = Object.fromEntries(
                Object.entries(storedResults.results).map(([userId, result]) => [userId, result?.totalScore])
            );
            rounds.push({ round, fixtures: getFixturesForRound(round), scores });
        }

        const ladder = tallyLadder(USER_NAMES, rounds, ({ row, userId, score, result, round }) => {
            const stored = storedByRound.get(round).results[userId];
            // Track high/low scores, form, stars, crabs
            if (score > row.highScore) row.highScore = score;
            if (round > 0 && score > 0 && (row.lowScore === null || score < row.lowScore)) row.lowScore = score;
            row.formHistory.push(result);
            if (stored?.hasStar) row.starsTotal += 1;
            if (stored?.hasCrab) row.crabsTotal += 1;
        }, () => ({ highScore: 0, lowScore: null, formHistory: [], starsTotal: 0, crabsTotal: 0 }));

        // This route's percentage is a 2dp string; finalise the extra stats
        ladder.forEach(team => {
            team.percentage = team.percentage.toFixed(2);
            team.lowScore = team.lowScore === null ? 0 : team.lowScore;
            team.form = team.formHistory.slice(-5).reverse();
            delete team.formHistory;
        });

        const sortedLadder = sortLadder(ladder);
        
        // Get last update time
        const lastUpdate = await db.collection(`${year}_simple_round_results`)
            .findOne({}, { sort: { lastUpdated: -1 }, projection: { lastUpdated: 1 } });
        
        return withReadCache(Response.json({
            ladder: sortedLadder,
            lastUpdated: lastUpdate?.lastUpdated || null,
            upToRound: maxRound
        }), 30);
        
    } catch (error) {
        console.error('API Error in GET /api/simple-ladder:', error);
        return Response.json({ error: 'Failed to get ladder' }, { status: 500 });
    }
}

/**
 * POST - Refresh and store round results from consolidated API
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const { round, refreshAll } = body;
        const year = parseInt(body.year) || CURRENT_YEAR;
        const { db } = await connectToDatabase();
        const collection = db.collection(`${year}_simple_round_results`);

        // Build base URL from the incoming request host (most reliable on Vercel)
        const host = request.headers.get('host');
        const baseUrl = process.env.NEXTAUTH_URL ||
            (host ? `https://${host}` : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'));

        if (refreshAll) {
            // Refresh all rounds 1-21
            console.log('Refreshing all rounds 1-21...');

            const results = {
                processed: [],
                failed: [],
                stored: [],
                incomplete: []
            };

            for (let r = 1; r <= 21; r++) {
                console.log(`Processing round ${r}...`);

                try {
                    // Fetch from consolidated-round-results API
                    const response = await fetch(`${baseUrl}/api/consolidated-round-results?round=${r}&year=${year}`);
                    
                    if (!response.ok) {
                        console.warn(`Failed to fetch round ${r}`);
                        results.failed.push(r);
                        continue;
                    }
                    
                    const data = await response.json();
                    
                    // Check if we have valid data
                    const hasValidData = data.results && 
                        Object.values(data.results).some(result => result.totalScore > 0);
                    
                    if (!hasValidData) {
                        console.log(`No valid data for round ${r}`);
                        results.failed.push(r);
                        continue;
                    }

                    // Only persist a snapshot for a fully-completed round, so an
                    // in-progress round can never be frozen in as a phantom draw.
                    if (!data.allGamesComplete) {
                        console.log(`Round ${r} not complete yet, skipping snapshot write`);
                        results.incomplete.push(r);
                        continue;
                    }

                    // Extract just the data we need
                    const roundData = {};
                    Object.entries(data.results).forEach(([userId, result]) => {
                        roundData[userId] = {
                            totalScore: result.totalScore || 0,
                            playerScore: result.playerScore || 0,
                            deadCertScore: result.deadCertScore || 0,
                            matchResult: result.matchResult || null,
                            opponent: result.opponent || null,
                            hasStar: result.hasStar || false,
                            hasCrab: result.hasCrab || false
                        };
                    });
                    
                    // Store in database
                    await collection.updateOne(
                        { round: r },
                        { 
                            $set: { 
                                round: r,
                                results: roundData,
                                lastUpdated: new Date()
                            } 
                        },
                        { upsert: true }
                    );
                    
                    console.log(`Stored round ${r} with ${Object.keys(roundData).length} user results`);
                    results.processed.push(r);
                    results.stored.push(r);
                    
                } catch (error) {
                    console.error(`Error processing round ${r}:`, error);
                    results.failed.push(r);
                }
            }
            
            return Response.json({
                success: true,
                message: 'Refresh complete',
                results
            });
            
        } else if (round) {
            // Refresh specific round
            console.log(`Refreshing round ${round}...`);

            // Fetch from consolidated-round-results API
            const response = await fetch(`${baseUrl}/api/consolidated-round-results?round=${round}&year=${year}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch round ${round} data`);
            }
            
            const data = await response.json();

            // Only persist a snapshot for a fully-completed round, so an
            // in-progress round can never be frozen in as a phantom draw.
            if (!data.allGamesComplete) {
                console.log(`Round ${round} not complete yet, skipping snapshot write`);
                return Response.json({
                    success: true,
                    skipped: true,
                    message: `Round ${round} is not complete yet; snapshot not written`
                });
            }

            // Extract just the data we need
            const roundData = {};
            Object.entries(data.results || {}).forEach(([userId, result]) => {
                roundData[userId] = {
                    totalScore: result.totalScore || 0,
                    playerScore: result.playerScore || 0,
                    deadCertScore: result.deadCertScore || 0,
                    matchResult: result.matchResult || null,
                    opponent: result.opponent || null,
                    hasStar: result.hasStar || false,
                    hasCrab: result.hasCrab || false
                };
            });

            // Store in database
            await collection.updateOne(
                { round: parseInt(round) },
                { 
                    $set: { 
                        round: parseInt(round),
                        results: roundData,
                        lastUpdated: new Date()
                    } 
                },
                { upsert: true }
            );
            
            return Response.json({
                success: true,
                message: `Round ${round} refreshed`,
                usersProcessed: Object.keys(roundData).length
            });
        }
        
        return Response.json({ error: 'Round or refreshAll required' }, { status: 400 });
        
    } catch (error) {
        console.error('API Error in POST /api/simple-ladder:', error);
        return Response.json({ error: 'Failed to refresh data' }, { status: 500 });
    }
}

/**
 * DELETE - Clear stored round results
 */
export async function DELETE(request) {
    try {
        if (getSessionUser(request)?.uid !== ADMIN_UID) {
            return Response.json({ error: 'Not authorised' }, { status: 403 });
        }
        const { searchParams } = new URL(request.url);
        const round = searchParams.get('round');
        const year = parseYearParam(searchParams);

        const { db } = await connectToDatabase();

        if (round) {
            // Delete specific round
            await db.collection(`${year}_simple_round_results`)
                .deleteOne({ round: parseInt(round) });

            return Response.json({
                success: true,
                message: `Cleared round ${round}`
            });
        } else {
            // Delete all rounds
            const result = await db.collection(`${year}_simple_round_results`)
                .deleteMany({});
            
            return Response.json({ 
                success: true, 
                message: `Cleared ${result.deletedCount} rounds` 
            });
        }
        
    } catch (error) {
        console.error('API Error in DELETE /api/simple-ladder:', error);
        return Response.json({ error: 'Failed to clear data' }, { status: 500 });
    }
}
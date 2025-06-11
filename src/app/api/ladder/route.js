import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

/**
 * GET handler for ladder data.
 * Retrieves ladder, using a cache that automatically updates.
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 0;
        
        const { db } = await connectToDatabase();
        
        // Automatically check and store results for any past rounds that need it.
        await checkAndStorePastRoundResults(db, round);
        
        const ladderCollection = db.collection(`${CURRENT_YEAR}_ladder`);
        
        // Check for a cached ladder
        const cachedLadder = await ladderCollection.findOne({ round: round });
        
        // Set a max age for the cache (e.g., 15 minutes)
        const CACHE_MAX_AGE_MS = 15 * 60 * 1000;
        const isCacheStale = !cachedLadder || !cachedLadder.lastUpdated || (new Date() - new Date(cachedLadder.lastUpdated) > CACHE_MAX_AGE_MS);
        
        if (cachedLadder && cachedLadder.standings && !isCacheStale) {
            console.log(`Returning fresh cached ladder for round ${round}`);
            return Response.json({
                standings: cachedLadder.standings,
                lastUpdated: cachedLadder.lastUpdated,
                fromCache: true
            });
        }
        
        // If cache is missing or stale, calculate a new ladder
        console.log(`Calculating new ladder for round ${round} (cache was ${cachedLadder ? 'stale' : 'missing'})`);
        const calculatedLadder = await calculateLadderFromAvailableData(db, round);
        
        const lastUpdated = new Date();

        // Save the newly calculated ladder to the cache
        await ladderCollection.updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    standings: calculatedLadder,
                    lastUpdated: lastUpdated,
                    calculatedFrom: 'auto_update'
                } 
            },
            { upsert: true }
        );
        
        return Response.json({
            standings: calculatedLadder,
            lastUpdated: lastUpdated,
            fromCache: false,
            calculated: true
        });
        
    } catch (error) {
        console.error('API Error in GET /api/ladder:', error);
        return Response.json({ error: 'Failed to fetch ladder data' }, { status: 500 });
    }
}

/**
 * POST handler to store/update ladder data (for manual overrides).
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, standings, forceRecalculate } = data;
        
        if (!round) {
            return Response.json({ error: 'Invalid data: round is required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        if (forceRecalculate) {
            console.log(`Force recalculating ladder for round ${round}`);
            const freshLadder = await calculateLadderFromAvailableData(db, round);
            
            await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
                { round: round },
                { $set: { round, standings: freshLadder, lastUpdated: new Date(), calculatedFrom: 'forced_recalculation' } },
                { upsert: true }
            );
            
            return Response.json({ success: true, standings: freshLadder, recalculated: true });
        }
        
        if (!Array.isArray(standings) || standings.length === 0) {
            return Response.json({ error: 'Invalid data: standings array required for manual update' }, { status: 400 });
        }
        
        await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
            { round: round },
            { $set: { round, standings, lastUpdated: new Date(), calculatedFrom: 'provided' } },
            { upsert: true }
        );
        
        return Response.json({ success: true });
    } catch (error) {
        console.error('API Error in POST /api/ladder:', error);
        return Response.json({ error: 'Failed to store ladder data' }, { status: 500 });
    }
}

/**
 * Checks all past rounds and stores their results if they are over a week old and not yet stored.
 */
async function checkAndStorePastRoundResults(db, currentRound) {
    try {
        for (let roundToCheck = 1; roundToCheck < currentRound; roundToCheck++) {
            const existingResults = await db.collection(`${CURRENT_YEAR}_round_results`).findOne({ round: roundToCheck });
            
            if (existingResults) {
                continue; // Already stored
            }
            
            const roundEndDate = await getRoundEndDate(roundToCheck);
            if (!roundEndDate) continue;
            
            const now = new Date();
            const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
            const oneWeekAfterRoundEnd = new Date(roundEndDate.getTime() + ONE_WEEK_MS);
            
            if (now > oneWeekAfterRoundEnd) {
                console.log(`Auto-storing results for round ${roundToCheck} (1 week has passed)`);
                await autoStoreRoundResults(db, roundToCheck);
            }
        }
    } catch (error) {
        console.error(`Error checking auto-store for currentRound ${currentRound}:`, error);
    }
}

/**
 * Fetches and stores the results for a specific round.
 */
async function autoStoreRoundResults(db, round) {
    try {
        const results = await calculateLiveRoundResults(round);
        
        if (Object.keys(results).length === 0) {
            console.warn(`No results to auto-store for round ${round}`);
            return;
        }

        await db.collection(`${CURRENT_YEAR}_round_results`).updateOne(
            { round: round },
            { $set: { round, results, lastUpdated: new Date(), source: 'auto_stored' } },
            { upsert: true }
        );
        
        console.log(`Auto-stored results for round ${round}:`, results);
        
    } catch (error) {
        console.error(`Error auto-storing results for round ${round}:`, error);
    }
}

/**
 * Gets the end date for a round (estimated as 3 hours after the last game).
 */
async function getRoundEndDate(round) {
    try {
        const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/tipping-data`);
        if (!response.ok) return null;
        
        const fixtures = await response.json();
        const roundFixtures = fixtures.filter(f => f.RoundNumber === round);
        
        if (roundFixtures.length === 0) return null;
        
        const lastFixture = roundFixtures.sort((a, b) => new Date(b.DateUtc) - new Date(a.DateUtc))[0];
        
        const roundEndDate = new Date(lastFixture.DateUtc);
        roundEndDate.setHours(roundEndDate.getHours() + 3);
        
        return roundEndDate;
        
    } catch (error) {
        console.error(`Error getting round end date for round ${round}:`, error);
        return null;
    }
}

/**
 * Calculates the ladder from all available data, using stored results where possible.
 */
async function calculateLadderFromAvailableData(db, currentRound) {
    console.log(`Calculating ladder from round 1 to ${currentRound}`);
    
    const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
        userId, userName, played: 0, wins: 0, losses: 0, draws: 0,
        pointsFor: 0, pointsAgainst: 0, percentage: 0, points: 0
    }));

    for (let round = 1; round <= Math.min(currentRound, 21); round++) {
        let roundResults = null;
        
        const storedResults = await db.collection(`${CURRENT_YEAR}_round_results`).findOne({ round });
            
        if (storedResults && storedResults.results) {
            console.log(`Using stored results for round ${round}`);
            roundResults = storedResults.results;
        } else {
            console.log(`Calculating live results for round ${round}`);
            roundResults = await calculateLiveRoundResults(round);
        }
        
        if (!roundResults || Object.keys(roundResults).length === 0) {
            console.log(`No results available for round ${round}, skipping`);
            continue;
        }
        
        const fixtures = getFixturesForRound(round);
        console.log(`Processing ${fixtures.length} fixtures for round ${round}`);
        
        fixtures.forEach((fixture, fixtureIndex) => {
            const homeUserId = String(fixture.home);
            const awayUserId = String(fixture.away);
            
            if (roundResults[homeUserId] === undefined || roundResults[awayUserId] === undefined) {
                console.log(`Missing results for fixture ${fixtureIndex + 1}: ${homeUserId} vs ${awayUserId}`);
                return;
            }
            
            const homeScore = roundResults[homeUserId];
            const awayScore = roundResults[awayUserId];
            
            console.log(`Round ${round} Fixture ${fixtureIndex + 1}: ${USER_NAMES[homeUserId]} (${homeScore}) vs ${USER_NAMES[awayUserId]} (${awayScore})`);
            
            const homeLadder = ladder.find(entry => entry.userId === homeUserId);
            const awayLadder = ladder.find(entry => entry.userId === awayUserId);
            
            if (homeLadder && awayLadder) {
                homeLadder.played++;
                awayLadder.played++;
                homeLadder.pointsFor += homeScore;
                homeLadder.pointsAgainst += awayScore;
                awayLadder.pointsFor += awayScore;
                awayLadder.pointsAgainst += homeScore;
                
                if (homeScore > awayScore) {
                    homeLadder.wins++;
                    homeLadder.points += 4;
                    awayLadder.losses++;
                    console.log(`  -> ${USER_NAMES[homeUserId]} WINS`);
                } else if (awayScore > homeScore) {
                    awayLadder.wins++;
                    awayLadder.points += 4;
                    homeLadder.losses++;
                    console.log(`  -> ${USER_NAMES[awayUserId]} WINS`);
                } else {
                    homeLadder.draws++;
                    homeLadder.points += 2;
                    awayLadder.draws++;
                    awayLadder.points += 2;
                    console.log(`  -> DRAW`);
                }
            }
        });
    }

    ladder.forEach(team => {
        team.percentage = team.pointsAgainst === 0 
            ? (team.pointsFor > 0 ? (team.pointsFor * 100).toFixed(2) : '0.00')
            : ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
            
        console.log(`Final ladder entry for ${team.userName}: ${team.wins}W-${team.losses}L-${team.draws}D, ${team.points} pts, ${team.pointsFor} PF, ${team.pointsAgainst} PA`);
    });

    const sortedLadder = ladder.sort((a, b) => b.points - a.points || b.percentage - a.percentage);
    
    console.log(`Ladder calculation complete for round ${currentRound}`);
    return sortedLadder;
}

/**
 * Calculates live round results using the EXACT same logic as the results page.
 * FIXED: NOW INCLUDES SUBSTITUTIONS AND DEAD CERT SCORES for accurate ladder calculations!
 */
async function calculateLiveRoundResults(round) {
    const results = {};
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    
    console.log(`Calculating live results for round ${round} with substitutions and dead certs included`);
    
    try {
        // Import the same scoring logic used by the results page
        const { POSITIONS } = await import('@/app/lib/scoring_rules');
        const { connectToDatabase } = await import('@/app/lib/mongodb');
        
        const { db } = await connectToDatabase();
        
        // Get team selections for this round
        const teamSelections = await db.collection(`${CURRENT_YEAR}_team_selection`)
            .find({ 
                Round: round,
                Active: 1 
            })
            .toArray();

        // Get player stats for this round
        const playerStats = await db.collection(`${CURRENT_YEAR}_game_results`)
            .find({ round: round })
            .toArray();

        // Check if round has ended (for reserve substitutions)
        const roundEndPassed = await checkIfRoundEnded(round);
        
        // Calculate scores for each user using the SAME logic as results page
        const userPromises = Object.keys(USER_NAMES).map(async (userId) => {
            try {
                console.log(`Calculating comprehensive score for user ${userId} round ${round}`);
                
                // Get this user's team selection
                const userTeamSelection = teamSelections.filter(selection => 
                    selection.User === parseInt(userId)
                );

                if (userTeamSelection.length === 0) {
                    console.log(`No team selection found for user ${userId} round ${round}`);
                    return { userId, total: 0 };
                }

                // Calculate team score with substitutions (same logic as results page)
                const teamScore = calculateTeamScoreWithSubstitutions(
                    userTeamSelection, 
                    playerStats, 
                    roundEndPassed,
                    userId
                );

                // Get dead cert score
                let deadCertScore = 0;
                try {
                    const tippingResponse = await fetch(`${baseUrl}/api/tipping-results?round=${round}&userId=${userId}`);
                    if (tippingResponse.ok) {
                        const tippingData = await tippingResponse.json();
                        deadCertScore = tippingData.deadCertScore || 0;
                    }
                } catch (tippingError) {
                    console.error(`Error getting tipping results for user ${userId} round ${round}:`, tippingError);
                    deadCertScore = 0;
                }

                // Final score = team score (with substitutions) + dead cert score
                const finalScore = teamScore + deadCertScore;
                console.log(`User ${userId} Round ${round}: Team=${teamScore} (with subs), DeadCert=${deadCertScore}, Final=${finalScore}`);
                
                return { userId, total: finalScore };
                
            } catch (error) {
                console.error(`Error calculating comprehensive score for user ${userId} round ${round}:`, error);
                return { userId, total: 0 };
            }
        });

        const userResults = await Promise.all(userPromises);
        userResults.forEach(({ userId, total }) => {
            results[userId] = total;
        });
        
        console.log(`Final round ${round} results with substitutions and dead certs:`, results);
        return results;
        
    } catch (error) {
        console.error(`Error in calculateLiveRoundResults for round ${round}:`, error);
        // Fallback to basic scoring if comprehensive scoring fails
        return await calculateBasicRoundResults(round);
    }
}

/**
 * Calculate team score with substitutions using the same logic as the results page
 */
function calculateTeamScoreWithSubstitutions(userTeamSelection, playerStats, roundEndPassed, userId) {
    const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
    const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];
    
    // Build team structure
    const team = {};
    userTeamSelection.forEach(selection => {
        team[selection.Position] = {
            player_name: selection.Player_Name,
            backup_position: selection.Backup_Position
        };
    });

    // Get stats for all players
    const playerStatsMap = {};
    playerStats.forEach(stat => {
        playerStatsMap[stat.player_name] = stat;
    });

    // Function to check if player played
    const didPlayerPlay = (stats) => {
        if (!stats) return false;
        return (stats.kicks > 0 || stats.handballs > 0 || stats.marks > 0 || 
                stats.tackles > 0 || stats.hitouts > 0 || stats.goals > 0 || stats.behinds > 0);
    };

    // Function to calculate score for a position
    const calculateScore = (position, stats, backupPosition = null) => {
        if (!stats) return { total: 0 };
        
        const safeStats = {
            kicks: stats.kicks || 0,
            handballs: stats.handballs || 0,
            marks: stats.marks || 0,
            tackles: stats.tackles || 0,
            hitouts: stats.hitouts || 0,
            goals: stats.goals || 0,
            behinds: stats.behinds || 0,
            ...stats
        };
        
        // If it's a bench position, use the backup position for scoring
        if ((position === 'Bench' || position.startsWith('Reserve')) && backupPosition) {
            const backupPositionType = backupPosition.toUpperCase().replace(/\s+/g, '_');
            try {
                const { POSITIONS } = require('@/app/lib/scoring_rules');
                return POSITIONS[backupPositionType]?.calculation(safeStats) || { total: 0 };
            } catch (error) {
                return { total: 0 };
            }
        }

        // For regular positions
        const formattedPosition = position.replace(/\s+/g, '_');
        try {
            const { POSITIONS } = require('@/app/lib/scoring_rules');
            return POSITIONS[formattedPosition]?.calculation(safeStats) || { total: 0 };
        } catch (error) {
            return { total: 0 };
        }
    };

    // Extract bench and reserve players
    const benchPlayers = Object.entries(team)
        .filter(([pos]) => pos === 'Bench')
        .map(([pos, data]) => {
            if (!data || !data.player_name || !data.backup_position) return null;
            const stats = playerStatsMap[data.player_name];
            const hasPlayed = didPlayerPlay(stats);
            if (!hasPlayed) return null;
            
            const backupPosType = data.backup_position.toUpperCase().replace(/\s+/g, '_');
            const scoring = calculateScore(backupPosType, stats);
            
            return {
                position: pos,
                playerName: data.player_name,
                backupPosition: data.backup_position,
                stats,
                score: scoring?.total || 0,
                hasPlayed
            };
        })
        .filter(Boolean);

    const reservePlayers = Object.entries(team)
        .filter(([pos]) => pos.startsWith('Reserve'))
        .map(([pos, data]) => {
            if (!data || !data.player_name) return null;
            const stats = playerStatsMap[data.player_name];
            const hasPlayed = didPlayerPlay(stats);
            if (!hasPlayed) return null;
            
            const isReserveA = pos === 'Reserve A';
            const validPositions = isReserveA ? RESERVE_A_POSITIONS : RESERVE_B_POSITIONS;
            
            if (data.backup_position) {
                validPositions.push(data.backup_position);
            }
            
            return {
                position: pos,
                playerName: data.player_name,
                backupPosition: data.backup_position,
                stats,
                hasPlayed,
                validPositions,
                isReserveA
            };
        })
        .filter(Boolean);

    // Calculate main position scores with substitutions
    const usedBenchPlayers = new Set();
    const usedReservePlayers = new Set();
    let totalScore = 0;

    // Process main positions
    const mainPositions = ['Full Forward', 'Tall Forward', 'Offensive', 'Midfielder', 'Tackler', 'Ruck'];
    
    for (const position of mainPositions) {
        const playerData = team[position];
        if (!playerData || !playerData.player_name) {
            continue; // No player selected for this position
        }

        const playerName = playerData.player_name;
        const stats = playerStatsMap[playerName];
        const hasPlayed = didPlayerPlay(stats);
        
        // Calculate original score
        const positionType = position.toUpperCase().replace(/\s+/g, '_');
        const scoring = calculateScore(positionType, stats);
        let positionScore = scoring?.total || 0;

        // Check for bench substitution (always available)
        const eligibleBench = benchPlayers
            .filter(b => !usedBenchPlayers.has(b.playerName) && b.backupPosition === position)
            .sort((a, b) => b.score - a.score);

        if (eligibleBench.length > 0 && eligibleBench[0].score > positionScore) {
            const bestBench = eligibleBench[0];
            positionScore = bestBench.score;
            usedBenchPlayers.add(bestBench.playerName);
            console.log(`  Bench substitution: ${bestBench.playerName} (${bestBench.score}) replaces ${playerName} (${scoring?.total || 0}) for ${position}`);
        }

        // Check for reserve substitution (only if round ended and player didn't play)
        if (roundEndPassed && !hasPlayed) {
            const isReserveAPosition = RESERVE_A_POSITIONS.includes(position);
            const isReserveBPosition = RESERVE_B_POSITIONS.includes(position);
            
            const eligibleReserves = reservePlayers
                .filter(r => {
                    if (usedReservePlayers.has(r.playerName)) return false;
                    if (r.backupPosition === position) return true;
                    const matchesType = (r.isReserveA && isReserveAPosition) || (!r.isReserveA && isReserveBPosition);
                    return matchesType;
                });

            if (eligibleReserves.length > 0) {
                const reserveScores = eligibleReserves.map(reserve => {
                    const posType = position.toUpperCase().replace(/\s+/g, '_');
                    const scoring = calculateScore(posType, reserve.stats);
                    return {
                        ...reserve,
                        calculatedScore: scoring?.total || 0,
                        priority: reserve.backupPosition === position ? 2 : 1
                    };
                });
                
                reserveScores.sort((a, b) => {
                    if (a.priority !== b.priority) return b.priority - a.priority;
                    return b.calculatedScore - a.calculatedScore;
                });
                
                if (reserveScores.length > 0 && reserveScores[0].calculatedScore > positionScore) {
                    const bestReserve = reserveScores[0];
                    positionScore = bestReserve.calculatedScore;
                    usedReservePlayers.add(bestReserve.playerName);
                    console.log(`  Reserve substitution: ${bestReserve.playerName} (${bestReserve.calculatedScore}) replaces ${playerName} (${scoring?.total || 0}) for ${position}`);
                }
            }
        }

        totalScore += positionScore;
        console.log(`  ${position}: ${playerName} = ${positionScore} points`);
    }

    console.log(`Total team score for user ${userId} with substitutions: ${totalScore}`);
    return totalScore;
}

/**
 * Check if a round has ended (for reserve substitution eligibility)
 */
async function checkIfRoundEnded(round) {
    try {
        const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/tipping-data`);
        if (!response.ok) return false;
        
        const fixtures = await response.json();
        const roundFixtures = fixtures.filter(f => f.RoundNumber === round);
        
        if (roundFixtures.length === 0) return false;
        
        const lastFixture = roundFixtures.sort((a, b) => new Date(b.DateUtc) - new Date(a.DateUtc))[0];
        const roundEndTime = new Date(lastFixture.DateUtc);
        roundEndTime.setHours(roundEndTime.getHours() + 3);
        
        return new Date() > roundEndTime;
    } catch (error) {
        console.error('Error checking if round ended:', error);
        return false;
    }
}

/**
 * Fallback basic scoring (original method) if comprehensive scoring fails
 */
async function calculateBasicRoundResults(round) {
    const results = {};
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    
    console.log(`Falling back to basic scoring for round ${round}`);
    
    const userPromises = Object.keys(USER_NAMES).map(async (userId) => {
        try {
            let teamScore = 0;
            const response = await fetch(`${baseUrl}/api/round-results?round=${round}&userId=${userId}`);
            if (response.ok) {
                const userData = await response.json();
                teamScore = userData.total || 0;
            }

            let deadCertScore = 0;
            try {
                const tippingResponse = await fetch(`${baseUrl}/api/tipping-results?round=${round}&userId=${userId}`);
                if (tippingResponse.ok) {
                    const tippingData = await tippingResponse.json();
                    deadCertScore = tippingData.deadCertScore || 0;
                }
            } catch (tippingError) {
                deadCertScore = 0;
            }

            const totalScore = teamScore + deadCertScore;
            return { userId, total: totalScore };
            
        } catch (error) {
            console.error(`Error getting basic results for user ${userId} round ${round}:`, error);
        }
        return { userId, total: 0 };
    });

    const userResults = await Promise.all(userPromises);
    userResults.forEach(({ userId, total }) => {
        results[userId] = total;
    });
    
    return results;
}

/**
 * DELETE handler to clear cached ladder data for a specific round.
 */
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        const result = await db.collection(`${CURRENT_YEAR}_ladder`).deleteOne({ round: round });
        
        if (result.deletedCount === 0) {
            return Response.json({ success: true, message: `No cached ladder to clear for round ${round}` });
        }

        return Response.json({ success: true, message: `Cleared cached ladder for round ${round}` });
        
    } catch (error) {
        console.error('API Error in DELETE /api/ladder:', error);
        return Response.json({ error: 'Failed to clear ladder data' }, { status: 500 });
    }
}
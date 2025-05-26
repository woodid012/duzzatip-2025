import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

/**
 * GET handler for stored round results
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter is required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        // Get stored results for this round
        const storedResults = await db.collection(`${CURRENT_YEAR}_round_results`)
            .findOne({ round: round });
        
        if (storedResults) {
            return Response.json({
                round: storedResults.round,
                results: storedResults.results,
                lastUpdated: storedResults.lastUpdated,
                found: true
            });
        }
        
        return Response.json({
            round: round,
            results: {},
            found: false,
            message: `No stored results found for round ${round}`
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch round results' }, { status: 500 });
    }
}

/**
 * POST handler to store round results
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, results, source } = data;
        
        if (!round || !results || typeof results !== 'object') {
            return Response.json(
                { error: 'Invalid data: round and results object required' }, 
                { status: 400 }
            );
        }
        
        // Validate that results contain valid user IDs
        const validUserIds = Object.keys(USER_NAMES);
        const resultUserIds = Object.keys(results);
        
        const invalidUsers = resultUserIds.filter(userId => !validUserIds.includes(userId));
        if (invalidUsers.length > 0) {
            return Response.json(
                { error: `Invalid user IDs: ${invalidUsers.join(', ')}` }, 
                { status: 400 }
            );
        }
        
        const { db } = await connectToDatabase();
        
        // Store the round results
        await db.collection(`${CURRENT_YEAR}_round_results`).updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    results: results,
                    lastUpdated: new Date(),
                    source: source || 'manual',
                    userCount: Object.keys(results).length
                } 
            },
            { upsert: true }
        );
        
        console.log(`Stored results for round ${round}: ${Object.keys(results).length} users`);
        
        // Also trigger ladder recalculation
        try {
            const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
            const ladderResponse = await fetch(`${baseUrl}/api/ladder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    round: round,
                    standings: [], // Will be recalculated
                    forceRecalculate: true
                })
            });
            
            if (!ladderResponse.ok) {
                console.warn('Failed to trigger ladder recalculation');
            }
        } catch (ladderError) {
            console.warn('Error triggering ladder recalculation:', ladderError);
        }
        
        return Response.json({ 
            success: true, 
            message: `Stored results for round ${round}`,
            userCount: Object.keys(results).length
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to store round results' }, { status: 500 });
    }
}

/**
 * PUT handler to calculate and store current round results
 */
export async function PUT(request) {
    try {
        const data = await request.json();
        const { round, forceRecalculate } = data;
        
        if (!round) {
            return Response.json({ error: 'Round parameter is required' }, { status: 400 });
        }
        
        // Check if results already exist and don't force recalculate
        if (!forceRecalculate) {
            try {
                const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
                const existingResults = await fetch(`${baseUrl}/api/store-round-results?round=${round}`);
                if (existingResults.ok) {
                    const existingData = await existingResults.json();
                    if (existingData.found) {
                        return Response.json({
                            success: true,
                            message: `Results for round ${round} already exist`,
                            results: existingData.results,
                            skipped: true
                        });
                    }
                }
            } catch (checkError) {
                console.warn('Error checking existing results:', checkError);
            }
        }
        
        console.log(`Calculating and storing results for round ${round}`);
        
        // Calculate current results using the existing results logic
        const calculatedResults = await calculateCurrentRoundResults(round);
        
        if (!calculatedResults || Object.keys(calculatedResults).length === 0) {
            return Response.json({
                success: false,
                message: `Could not calculate results for round ${round}`,
                results: {}
            }, { status: 400 });
        }
        
        // Store the calculated results
        try {
            const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
            const storeResponse = await fetch(`${baseUrl}/api/store-round-results`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    round: round,
                    results: calculatedResults,
                    source: 'calculated'
                })
            });
            
            if (!storeResponse.ok) {
                const errorData = await storeResponse.json();
                throw new Error(errorData.error || 'Failed to store calculated results');
            }
        } catch (storeError) {
            console.error('Error storing calculated results:', storeError);
            throw storeError;
        }
        
        return Response.json({
            success: true,
            message: `Calculated and stored results for round ${round}`,
            results: calculatedResults,
            userCount: Object.keys(calculatedResults).length
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to calculate and store round results' }, { status: 500 });
    }
}

/**
 * Calculate current round results using the same logic as useResults hook
 * This ensures identical scoring including substitutions, bench players, and dead certs
 */
async function calculateCurrentRoundResults(round) {
    try {
        const { db } = await connectToDatabase();
        const results = {};
        
        console.log(`Calculating complete results for round ${round} using useResults logic`);
        
        // Get team selection data for all users
        const teamSelections = await db.collection(`${CURRENT_YEAR}_team_selection`)
            .find({ Round: round, Active: 1 }).toArray();
        
        // Get all player stats for this round
        const gameStats = await db.collection(`${CURRENT_YEAR}_game_results`)
            .find({ round: round }).toArray();
        
        // Check if round has ended (needed for reserve substitutions)
        const now = new Date();
        const roundEndPassed = await checkIfRoundEnded(round, now);
        
        console.log(`Round ${round} end passed: ${roundEndPassed}`);
        
        // Process each user's team using the same logic as useResults
        for (const userId of Object.keys(USER_NAMES)) {
            try {
                const teamScore = await calculateUserScore(userId, round, teamSelections, gameStats, roundEndPassed);
                results[userId] = teamScore;
                console.log(`Complete score for user ${userId} round ${round}: ${teamScore}`);
            } catch (userError) {
                console.error(`Error calculating score for user ${userId}:`, userError);
                results[userId] = 0;
            }
        }
        
        console.log(`Final complete results for round ${round}:`, results);
        return results;
        
    } catch (error) {
        console.error('Error calculating complete round results:', error);
        return {};
    }
}

/**
 * Calculate individual user score using the same logic as useResults getTeamScores
 */
async function calculateUserScore(userId, round, teamSelections, gameStats, roundEndPassed) {
    try {
        // Get user's team selection
        const userTeam = {};
        const userSelections = teamSelections.filter(selection => selection.User.toString() === userId);
        
        userSelections.forEach(selection => {
            userTeam[selection.Position] = {
                player_name: selection.Player_Name,
                backup_position: selection.Backup_Position || null
            };
        });
        
        // Create player stats mapping
        const playerStats = {};
        Object.entries(userTeam).forEach(([position, data]) => {
            if (!data || !data.player_name) return;
            
            const playerStat = gameStats.find(stat => stat.player_name === data.player_name);
            if (playerStat) {
                playerStats[data.player_name] = playerStat;
            }
        });
        
        // Apply the same scoring logic as useResults
        const teamScoreData = calculateTeamScoreWithSubstitutions(userTeam, playerStats, roundEndPassed);
        
        // Get dead cert scores
        const deadCertScore = await getDeadCertScore(userId, round);
        
        // Return final score (team + dead cert)
        const finalScore = teamScoreData.totalScore + deadCertScore;
        
        console.log(`User ${userId}: Team=${teamScoreData.totalScore}, DeadCert=${deadCertScore}, Final=${finalScore}`);
        
        return finalScore;
        
    } catch (error) {
        console.error(`Error calculating user ${userId} score:`, error);
        return 0;
    }
}

/**
 * Calculate team score with substitutions (same logic as useResults getTeamScores)
 */
function calculateTeamScoreWithSubstitutions(userTeam, playerStats, roundEndPassed) {
    const POSITION_TYPES = [
        'Full Forward', 'Tall Forward', 'Offensive', 'Midfielder', 'Tackler', 'Ruck'
    ];
    
    const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
    const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];
    
    // Helper function to check if player played
    const didPlayerPlay = (stats) => {
        if (!stats) return false;
        return (
            (stats.kicks && stats.kicks > 0) || 
            (stats.handballs && stats.handballs > 0) || 
            (stats.marks && stats.marks > 0) || 
            (stats.tackles && stats.tackles > 0) || 
            (stats.hitouts && stats.hitouts > 0) || 
            (stats.goals && stats.goals > 0) || 
            (stats.behinds && stats.behinds > 0)
        );
    };
    
    // Calculate score for a position
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
        
        // Import scoring rules
        const POSITIONS = {
            FULL_FORWARD: {
                calculation: (stats) => ({
                    total: stats.goals * 9 + stats.behinds,
                })
            },
            MIDFIELDER: {
                calculation: (stats) => {
                    const disposals = stats.kicks + stats.handballs;
                    const baseDisposals = Math.min(disposals, 30);
                    const extraDisposals = Math.max(0, disposals - 30);
                    return {
                        total: baseDisposals + (extraDisposals * 3),
                    };
                }
            },
            OFFENSIVE: {
                calculation: (stats) => ({
                    total: stats.goals * 7 + stats.kicks,
                })
            },
            TALL_FORWARD: {
                calculation: (stats) => ({
                    total: stats.goals * 6 + stats.marks * 2,
                })
            },
            TACKLER: {
                calculation: (stats) => ({
                    total: stats.tackles * 4 + stats.handballs,
                })
            },
            RUCK: {
                calculation: (stats) => {
                    const totalHitoutsMarks = stats.hitouts + stats.marks;
                    if (totalHitoutsMarks <= 18) {
                        return { total: totalHitoutsMarks };
                    }
                    const regularMarks = Math.max(0, 18 - stats.hitouts);
                    const bonusMarks = stats.marks - regularMarks;
                    return { total: stats.hitouts + regularMarks + (bonusMarks * 3) };
                }
            }
        };
        
        // Use backup position for bench players
        if ((position === 'BENCH' || position.startsWith('RESERVE')) && backupPosition) {
            const backupPositionType = backupPosition.toUpperCase().replace(/\s+/g, '_');
            try {
                return POSITIONS[backupPositionType]?.calculation(safeStats) || { total: 0 };
            } catch (error) {
                return { total: 0 };
            }
        }

        const formattedPosition = position.replace(/\s+/g, '_');
        try {
            return POSITIONS[formattedPosition]?.calculation(safeStats) || { total: 0 };
        } catch (error) {
            return { total: 0 };
        }
    };
    
    // Extract bench players with their backup positions
    const benchPlayers = Object.entries(userTeam)
        .filter(([pos]) => pos === 'Bench')
        .map(([pos, data]) => {
            if (!data || !data.player_name || !data.backup_position) return null;
            
            const stats = playerStats[data.player_name];
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
    
    // Extract reserve players
    const reservePlayers = Object.entries(userTeam)
        .filter(([pos]) => pos.startsWith('Reserve'))
        .map(([pos, data]) => {
            if (!data || !data.player_name) return null;
            
            const stats = playerStats[data.player_name];
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
    
    // Process main positions and apply substitutions
    const usedBenchPlayers = new Set();
    const usedReservePlayers = new Set();
    
    const positionScores = POSITION_TYPES.map(position => {
        const playerData = userTeam[position];
        if (!playerData || !playerData.player_name) {
            return { position, score: 0 };
        }
        
        const playerName = playerData.player_name;
        const stats = playerStats[playerName];
        const hasPlayed = didPlayerPlay(stats);
        
        const positionType = position.toUpperCase().replace(/\s+/g, '_');
        const scoring = calculateScore(positionType, stats);
        const originalScore = scoring?.total || 0;
        
        return {
            position,
            playerName,
            originalPlayerName: playerName,
            player: stats,
            score: originalScore,
            originalScore,
            hasPlayed,
            isBenchPlayer: false,
            noStats: !hasPlayed
        };
    });
    
    // Step 1: Bench substitutions (always available)
    for (const benchPlayer of benchPlayers) {
        const { backupPosition, playerName, score } = benchPlayer;
        
        const positionIndex = positionScores.findIndex(p => p.position === backupPosition);
        if (positionIndex === -1) continue;
        
        const positionPlayer = positionScores[positionIndex];
        const originalScore = positionPlayer.score;
        
        if (score > originalScore) {
            positionScores[positionIndex] = {
                ...positionPlayer,
                player: benchPlayer.stats,
                playerName: benchPlayer.playerName,
                score: benchPlayer.score,
                originalScore,
                isBenchPlayer: true,
                replacementType: 'Bench'
            };
            
            usedBenchPlayers.add(playerName);
        }
    }
    
    // Step 2: Reserve substitutions (only if round has ended)
    if (roundEndPassed) {
        for (let i = 0; i < positionScores.length; i++) {
            const positionData = positionScores[i];
            
            if (positionData.hasPlayed || positionData.isBenchPlayer) continue;
            
            const position = positionData.position;
            const originalScore = positionData.score;
            
            // Try remaining bench players first
            const eligibleBench = benchPlayers
                .filter(b => !usedBenchPlayers.has(b.playerName) && b.backupPosition === position)
                .sort((a, b) => b.score - a.score);
            
            if (eligibleBench.length > 0) {
                const bestBench = eligibleBench[0];
                
                positionScores[i] = {
                    ...positionData,
                    player: bestBench.stats,
                    playerName: bestBench.playerName,
                    score: bestBench.score,
                    originalScore,
                    isBenchPlayer: true,
                    replacementType: 'Bench'
                };
                
                usedBenchPlayers.add(bestBench.playerName);
                continue;
            }
            
            // Try reserve players
            const isReserveAPosition = RESERVE_A_POSITIONS.includes(position);
            const isReserveBPosition = RESERVE_B_POSITIONS.includes(position);
            
            const eligibleReserves = reservePlayers
                .filter(r => {
                    if (usedReservePlayers.has(r.playerName)) return false;
                    if (r.backupPosition === position) return true;
                    return (r.isReserveA && isReserveAPosition) || 
                           (!r.isReserveA && isReserveBPosition);
                });
            
            if (eligibleReserves.length > 0) {
                const reserveScores = eligibleReserves.map(reserve => {
                    const positionType = position.toUpperCase().replace(/\s+/g, '_');
                    const scoring = calculateScore(positionType, reserve.stats);
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
                
                if (reserveScores.length > 0) {
                    const bestReserve = reserveScores[0];
                    
                    positionScores[i] = {
                        ...positionData,
                        player: bestReserve.stats,
                        playerName: bestReserve.playerName,
                        score: bestReserve.calculatedScore,
                        originalScore,
                        isBenchPlayer: true,
                        replacementType: bestReserve.position
                    };
                    
                    usedReservePlayers.add(bestReserve.playerName);
                }
            }
        }
    }
    
    // Calculate total score
    const totalScore = positionScores.reduce((total, pos) => total + pos.score, 0);
    
    return {
        totalScore,
        positionScores
    };
}

/**
 * Check if round has ended
 */
async function checkIfRoundEnded(round, now) {
    try {
        // For now, use a simple heuristic - you can make this more sophisticated
        // Check if it's been more than 4 hours since the last game of the round would have started
        
        // This is a simplified version - you might want to integrate with your fixture data
        // For round 6 specifically, let's assume it has ended for testing
        if (round === 6) {
            return true;
        }
        
        // For other rounds, you can implement more sophisticated logic
        // For now, return true if it's a past round compared to current time
        const currentHour = now.getHours();
        const currentDay = now.getDay();
        
        // Simple heuristic: if it's Monday and after 6 PM, assume weekend round has ended
        if (currentDay === 1 && currentHour >= 18) {
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('Error checking if round ended:', error);
        return false;
    }
}

/**
 * Get dead cert score for a user
 */
async function getDeadCertScore(userId, round) {
    try {
        const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/tipping-results?round=${round}&userId=${userId}`);
        
        if (response.ok) {
            const tippingData = await response.json();
            return tippingData.deadCertScore || 0;
        }
        
        return 0;
    } catch (error) {
        console.warn(`Could not fetch dead cert score for user ${userId}:`, error);
        return 0;
    }
}

/**
 * DELETE handler to remove stored round results
 */
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        // Delete the round results
        const deleteResult = await db.collection(`${CURRENT_YEAR}_round_results`)
            .deleteOne({ round: round });
        
        // Also clear the cached ladder
        await db.collection(`${CURRENT_YEAR}_ladder`).deleteOne({ round: round });
        
        return Response.json({ 
            success: true, 
            message: `Deleted results for round ${round}`,
            deleted: deleteResult.deletedCount > 0
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to delete round results' }, { status: 500 });
    }
}
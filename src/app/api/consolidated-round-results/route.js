// src/app/api/consolidated-round-results/route.js

import { connectToDatabase } from '@/app/lib/mongodb';
import { POSITIONS } from '@/app/lib/scoring_rules';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));

        if (!round) {
            return Response.json({ error: 'Round parameter is required' }, { status: 400 });
        }

        console.log(`Getting consolidated results for round ${round}`);

        // Get all user results for this round using the same logic as your working APIs
        const results = {};
        const allTeamScores = [];

        for (const userId of Object.keys(USER_NAMES)) {
            try {
                console.log(`Processing user ${userId} (${USER_NAMES[userId]})`);
                
                // Use the same logic as your round-results API
                const userResult = await getUserRoundResult(round, userId);
                results[userId] = userResult;
                allTeamScores.push({
                    userId,
                    totalScore: userResult.totalScore
                });
                
                console.log(`User ${userId} total score: ${userResult.totalScore}`);
            } catch (error) {
                console.error(`Error processing user ${userId}:`, error);
                results[userId] = createEmptyResult(userId);
                allTeamScores.push({ userId, totalScore: 0 });
            }
        }

        // Calculate stars and crabs
        const validScores = allTeamScores.filter(s => s.totalScore > 0);
        let highestScore = 0;
        let lowestScore = 0;
        let starWinners = [];
        let crabWinners = [];

        if (validScores.length > 0) {
            highestScore = Math.max(...validScores.map(s => s.totalScore));
            lowestScore = Math.min(...validScores.map(s => s.totalScore));
            
            starWinners = validScores
                .filter(s => s.totalScore === highestScore)
                .map(s => s.userId);
            
            if (lowestScore < highestScore) {
                crabWinners = validScores
                    .filter(s => s.totalScore === lowestScore)
                    .map(s => s.userId);
            }
        }

        console.log(`Stars: ${starWinners}, Crabs: ${crabWinners}`);

        // Add star/crab flags to results
        Object.keys(results).forEach(userId => {
            results[userId].hasStar = starWinners.includes(userId);
            results[userId].hasCrab = crabWinners.includes(userId);
        });

        // Add fixture results (Win/Loss/Draw) and PF/PA
        const fixtures = getFixturesForRound(round);
        fixtures.forEach(fixture => {
            const homeUserId = String(fixture.home);
            const awayUserId = String(fixture.away);
            
            if (results[homeUserId] && results[awayUserId]) {
                const homeScore = results[homeUserId].totalScore;
                const awayScore = results[awayUserId].totalScore;
                
                // Determine match result
                let homeResult, awayResult;
                if (homeScore > awayScore) {
                    homeResult = 'W';
                    awayResult = 'L';
                } else if (awayScore > homeScore) {
                    homeResult = 'L';
                    awayResult = 'W';
                } else {
                    homeResult = 'D';
                    awayResult = 'D';
                }
                
                // Add match info for home team
                results[homeUserId].matchResult = homeResult;
                results[homeUserId].opponent = USER_NAMES[awayUserId];
                results[homeUserId].opponentScore = awayScore;
                results[homeUserId].isHome = true;
                results[homeUserId].pointsFor = homeScore;
                results[homeUserId].pointsAgainst = awayScore;
                
                // Add match info for away team
                results[awayUserId].matchResult = awayResult;
                results[awayUserId].opponent = USER_NAMES[homeUserId];
                results[awayUserId].opponentScore = homeScore;
                results[awayUserId].isHome = false;
                results[awayUserId].pointsFor = awayScore;
                results[awayUserId].pointsAgainst = homeScore;
                
                console.log(`Match: ${USER_NAMES[homeUserId]} (${homeScore}) vs ${USER_NAMES[awayUserId]} (${awayScore}) - Winner: ${homeScore > awayScore ? USER_NAMES[homeUserId] : awayScore > homeScore ? USER_NAMES[awayUserId] : 'Draw'}`);
            }
        });

        console.log(`Completed consolidated results for round ${round}`);

        return Response.json({
            round,
            results,
            summary: {
                highestScore,
                lowestScore,
                starWinners: starWinners.map(id => ({ userId: id, userName: USER_NAMES[id] })),
                crabWinners: crabWinners.map(id => ({ userId: id, userName: USER_NAMES[id] })),
                totalPlayers: Object.keys(results).length
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch consolidated round results' }, { status: 500 });
    }
}

// Use the exact same logic as your round-results API
async function getUserRoundResult(round, userId) {
    try {
        const { db } = await connectToDatabase();

        // Get team selection - same as round-results API
        const teamSelection = await db.collection(`${CURRENT_YEAR}_team_selection`)
            .find({ 
                Round: round,
                User: parseInt(userId),
                Active: 1 
            })
            .toArray();

        // Get player stats - same as round-results API  
        const playerStats = await db.collection(`${CURRENT_YEAR}_game_results`)
            .find({ round: round })
            .toArray();

        if (!teamSelection || teamSelection.length === 0) {
            console.log(`No team selection found for user ${userId} round ${round}`);
            return createEmptyResult(userId);
        }

        // Process positions with substitutions (same logic as useResults hook)
        const teamScoreData = calculateTeamScoresWithSubstitutions(teamSelection, playerStats, round);
        const playerScore = teamScoreData.totalScore;
        const positions = teamScoreData.positionScores;

        // Fetch dead cert score - use the same logic as your tipping-results API
        let deadCertScore = 0;
        try {
            // First try the API approach (like your results page)
            const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
            const tippingResponse = await fetch(`${baseUrl}/api/tipping-results?round=${round}&userId=${userId}`);
            
            if (tippingResponse.ok) {
                const tippingData = await tippingResponse.json();
                deadCertScore = tippingData.deadCertScore || 0;
                console.log(`User ${userId} dead cert score from API: ${deadCertScore}`);
            } else {
                console.log(`Tipping results API failed for user ${userId} round ${round}:`, tippingResponse.status);
                // Fallback: calculate directly like tipping-results API does
                deadCertScore = await calculateDeadCertScore(db, round, userId);
            }
        } catch (tippingError) {
            console.error(`Error fetching tipping results for user ${userId} round ${round}:`, tippingError);
            // Fallback: calculate directly
            deadCertScore = await calculateDeadCertScore(db, round, userId);
        }

        const totalScore = playerScore + deadCertScore;

        console.log(`User ${userId}: Player score ${playerScore}, Dead cert ${deadCertScore}, Total ${totalScore}`);

        return {
            userId,
            userName: USER_NAMES[userId],
            playerScore,
            deadCertScore,
            totalScore,
            positions, // Simplified position scores only
            substitutionsUsed: teamScoreData.substitutionsUsed, // What substitutions were made
            hasStar: false, // Will be set later
            hasCrab: false, // Will be set later
            matchResult: null, // Will be set later
            opponent: null,
            opponentScore: 0,
            isHome: false,
            pointsFor: 0, // Will be set to totalScore in fixture processing
            pointsAgainst: 0 // Will be set to opponent's totalScore in fixture processing
        };

    } catch (error) {
        console.error(`Error calculating result for user ${userId}:`, error);
        return createEmptyResult(userId);
    }
}

function createEmptyResult(userId) {
    return {
        userId,
        userName: USER_NAMES[userId],
        playerScore: 0,
        deadCertScore: 0,
        totalScore: 0,
        positions: [],
        substitutionsUsed: [],
        hasStar: false,
        hasCrab: false,
        matchResult: null,
        opponent: null,
        opponentScore: 0,
        isHome: false,
        pointsFor: 0,
        pointsAgainst: 0
    };
}

// Fallback function to calculate dead cert score directly (same logic as tipping-results API)
async function calculateDeadCertScore(db, round, userId) {
    try {
        console.log(`Calculating dead cert score directly for user ${userId} round ${round}`);
        
        // Get fixtures for this round (same as tipping-results API)
        const path = require('path');
        const fs = require('fs/promises');
        
        const fixturesPath = path.join(process.cwd(), 'public', `afl-${CURRENT_YEAR}.json`);
        const fixturesData = await fs.readFile(fixturesPath, 'utf8');
        const fixtures = JSON.parse(fixturesData);
        
        // Filter completed matches for the round
        const completedMatches = fixtures.filter(match => 
            match.RoundNumber.toString() === round.toString() &&
            match.HomeTeamScore !== null &&
            match.AwayTeamScore !== null
        );

        if (completedMatches.length === 0) {
            console.log(`No completed matches found for round ${round}`);
            return 0;
        }

        // Get tips from database
        const tips = await db.collection(`${CURRENT_YEAR}_tips`)
            .find({ 
                Round: parseInt(round),
                User: parseInt(userId),
                Active: 1 
            }).toArray();

        console.log(`Found ${tips.length} tips for user ${userId} round ${round}`);

        // Get all matches for this round (including those without scores yet)
        const allRoundMatches = fixtures.filter(match => 
            match.RoundNumber.toString() === round.toString()
        );

        // Process all matches with tips
        const allMatchesWithTips = [];
        
        allRoundMatches.forEach(match => {
            const tip = tips.find(t => t.MatchNumber === match.MatchNumber);
            
            const isCompleted = match.HomeTeamScore !== null && match.AwayTeamScore !== null;
            
            let isCorrect = false;
            let tipTeam = tip ? tip.Team : match.HomeTeam; // Default to home team
            let isDefault = !tip;
            let isDeadCert = tip ? tip.DeadCert : false;
            
            if (isCompleted) {
                const winningTeam = match.HomeTeamScore > match.AwayTeamScore 
                    ? match.HomeTeam 
                    : match.AwayTeamScore > match.HomeTeamScore 
                        ? match.AwayTeam 
                        : 'Draw';
                        
                isCorrect = tipTeam === winningTeam;
            }
            
            allMatchesWithTips.push({
                matchNumber: match.MatchNumber,
                homeTeam: match.HomeTeam,
                awayTeam: match.AwayTeam,
                homeScore: match.HomeTeamScore,
                awayScore: match.AwayTeamScore,
                tip: tipTeam,
                deadCert: isDeadCert,
                correct: isCompleted ? isCorrect : null,
                isDefault: isDefault,
                isCompleted: isCompleted
            });
        });
        
        // Calculate dead cert score (only count completed matches)
        const { deadCertScore } = calculateScores(
            allMatchesWithTips.filter(m => m.isCompleted)
        );
        
        console.log(`Calculated dead cert score for user ${userId} round ${round}: ${deadCertScore}`);
        return deadCertScore;
        
    } catch (error) {
        console.error(`Error calculating dead cert score for user ${userId} round ${round}:`, error);
        return 0;
    }
}

// Helper function to calculate scores from completed matches (same as tipping-results API)
function calculateScores(completedMatches) {
    let correctTips = 0;
    let deadCertScore = 0;
    
    completedMatches.forEach(match => {
        if (match.correct) {
            correctTips++;
            if (match.deadCert) {
                deadCertScore += 6;
            }
        } else if (match.deadCert) {
            deadCertScore -= 12;
        }
    });
    
    return { correctTips, deadCertScore };
}

// Calculate team scores with substitutions (same logic as useResults hook)
function calculateTeamScoresWithSubstitutions(teamSelection, playerStats, round) {
    const POSITION_TYPES = [
        'Full Forward', 
        'Tall Forward', 
        'Offensive', 
        'Midfielder', 
        'Tackler', 
        'Ruck'
    ];
    
    const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
    const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];
    
    // Create player stats map
    const statsMap = {};
    playerStats.forEach(stat => {
        statsMap[stat.player_name] = stat;
    });
    
    // Check if round has ended (for reserve substitutions) - assume true for API
    const roundEndPassed = true;
    
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
    
    // Helper function to calculate score
    const calculateScore = (position, stats, backupPosition = null) => {
        if (!stats) return { total: 0, breakdown: [] };
        
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
        
        if ((position === 'BENCH' || position.startsWith('RESERVE')) && backupPosition) {
            const backupPositionType = backupPosition.toUpperCase().replace(/\s+/g, '_');
            try {
                return POSITIONS[backupPositionType]?.calculation(safeStats) || { total: 0, breakdown: [] };
            } catch (error) {
                return { total: 0, breakdown: [] };
            }
        }

        const formattedPosition = position.replace(/\s+/g, '_');
        try {
            return POSITIONS[formattedPosition]?.calculation(safeStats) || { total: 0, breakdown: [] };
        } catch (error) {
            return { total: 0, breakdown: [] };
        }
    };
    
    // Create team selection map
    const teamMap = {};
    teamSelection.forEach(selection => {
        teamMap[selection.Position] = {
            player_name: selection.Player_Name,
            backup_position: selection.Backup_Position
        };
    });
    
    // Extract bench players with their backup positions
    const benchPlayers = Object.entries(teamMap)
        .filter(([pos]) => pos === 'Bench')
        .map(([pos, data]) => {
            if (!data || !data.player_name || !data.backup_position) return null;
            
            const stats = statsMap[data.player_name];
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
                breakdown: scoring?.breakdown || '',
                hasPlayed
            };
        })
        .filter(Boolean);
    
    // Extract reserve players
    const reservePlayers = Object.entries(teamMap)
        .filter(([pos]) => pos.startsWith('Reserve'))
        .map(([pos, data]) => {
            if (!data || !data.player_name) return null;
            
            const stats = statsMap[data.player_name];
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
    const substitutionsUsed = [];
    
    // Calculate scores for all main positions
    const positionScores = POSITION_TYPES.map(position => {
        const playerData = teamMap[position];
        if (!playerData || !playerData.player_name) {
            return {
                position,
                playerName: null,
                score: 0,
                isSubstitution: false
            };
        }
        
        const playerName = playerData.player_name;
        const stats = statsMap[playerName];
        const hasPlayed = didPlayerPlay(stats);
        
        const positionType = position.toUpperCase().replace(/\s+/g, '_');
        const scoring = calculateScore(positionType, stats);
        const originalScore = scoring?.total || 0;
        
        let finalScore = originalScore;
        let finalPlayerName = playerName;
        let isSubstitution = false;
        let substitutionType = null;
        
        // Step 1: Check if any bench player has a higher score
        for (const benchPlayer of benchPlayers) {
            if (usedBenchPlayers.has(benchPlayer.playerName)) continue;
            if (benchPlayer.backupPosition !== position) continue;
            
            if (benchPlayer.score > originalScore) {
                finalScore = benchPlayer.score;
                finalPlayerName = benchPlayer.playerName;
                isSubstitution = true;
                substitutionType = 'Bench';
                usedBenchPlayers.add(benchPlayer.playerName);
                
                substitutionsUsed.push({
                    position,
                    originalPlayer: playerName,
                    replacementPlayer: benchPlayer.playerName,
                    type: 'Bench',
                    originalScore,
                    replacementScore: benchPlayer.score
                });
                break;
            }
        }
        
        // Step 2: If player didn't play and no bench substitution, try reserves
        if (!isSubstitution && !hasPlayed && roundEndPassed) {
            const isReserveAPosition = RESERVE_A_POSITIONS.includes(position);
            const isReserveBPosition = RESERVE_B_POSITIONS.includes(position);
            
            const eligibleReserves = reservePlayers
                .filter(r => {
                    if (usedReservePlayers.has(r.playerName)) return false;
                    if (r.backupPosition === position) return true;
                    return (r.isReserveA && isReserveAPosition) || (!r.isReserveA && isReserveBPosition);
                });
            
            if (eligibleReserves.length > 0) {
                const reserveScores = eligibleReserves.map(reserve => {
                    const positionType = position.toUpperCase().replace(/\s+/g, '_');
                    const scoring = calculateScore(positionType, reserve.stats);
                    return {
                        ...reserve,
                        calculatedScore: scoring?.total || 0,
                        breakdown: scoring?.breakdown || '',
                        priority: reserve.backupPosition === position ? 2 : 1
                    };
                });
                
                reserveScores.sort((a, b) => {
                    if (a.priority !== b.priority) return b.priority - a.priority;
                    return b.calculatedScore - a.calculatedScore;
                });
                
                if (reserveScores.length > 0) {
                    const bestReserve = reserveScores[0];
                    finalScore = bestReserve.calculatedScore;
                    finalPlayerName = bestReserve.playerName;
                    isSubstitution = true;
                    substitutionType = bestReserve.position;
                    usedReservePlayers.add(bestReserve.playerName);
                    
                    substitutionsUsed.push({
                        position,
                        originalPlayer: playerName,
                        replacementPlayer: bestReserve.playerName,
                        type: bestReserve.position,
                        originalScore,
                        replacementScore: bestReserve.calculatedScore
                    });
                }
            }
        }
        
        return {
            position,
            playerName: finalPlayerName,
            originalPlayerName: playerName,
            score: finalScore,
            originalScore,
            isSubstitution,
            substitutionType
        };
    });
    
    const totalScore = positionScores.reduce((sum, pos) => sum + pos.score, 0);
    
    return {
        totalScore,
        positionScores: positionScores.map(pos => ({
            position: pos.position,
            playerName: pos.playerName,
            score: pos.score,
            isSubstitution: pos.isSubstitution,
            substitutionType: pos.substitutionType
        })),
        substitutionsUsed
    };
}
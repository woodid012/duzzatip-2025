// src/app/api/ladder/route.js

import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { parseYearParam } from '@/app/lib/apiUtils';

/**
 * GET handler for ladder data.
 * First checks database for cached ladder, then calculates if needed
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 0;
        const getRoundSummary = searchParams.get('getRoundSummary') === 'true';
        const year = parseYearParam(searchParams);

        const { db } = await connectToDatabase();

        // Handle round summary requests
        if (getRoundSummary) {
            return await handleGetRoundSummary(round, db, year);
        }

        const ladderCollection = db.collection(`${year}_ladder`);
        
        // Check for cached ladder in database
        const cachedLadder = await ladderCollection.findOne({ round: round });
        
        // Set cache max age (15 minutes) - but only for auto-calculated ladders
        const CACHE_MAX_AGE_MS = 15 * 60 * 1000;
        const isCacheStale = !cachedLadder || !cachedLadder.lastUpdated || 
            (new Date() - new Date(cachedLadder.lastUpdated) > CACHE_MAX_AGE_MS);
        
        // Only use cache if it's fresh AND was calculated from the correct source
        const isValidCache = cachedLadder && 
                           cachedLadder.standings && 
                           !isCacheStale && 
                           (cachedLadder.calculatedFrom === 'complete_refresh_from_scratch_calculations' || 
                            cachedLadder.calculatedFrom === 'stored_final_totals_auto');
        
        if (isValidCache) {
            console.log(`Returning valid cached ladder for round ${round} (${cachedLadder.calculatedFrom})`);
            return Response.json({
                standings: cachedLadder.standings,
                lastUpdated: cachedLadder.lastUpdated,
                fromCache: true,
                calculatedFrom: cachedLadder.calculatedFrom
            });
        }
        
        // If cache is missing, stale, or from wrong source, build fresh ladder
        console.log(`Building fresh ladder for round ${round} (cache invalid or missing)`);
        const calculatedLadder = await buildLadderFromStoredFinalTotals(round, db, year);

        const lastUpdated = new Date();

        // Save the newly calculated ladder to database (only for current year)
        if (year === CURRENT_YEAR) {
            await ladderCollection.updateOne(
                { round: round },
                {
                    $set: {
                        round: round,
                        standings: calculatedLadder,
                        lastUpdated: lastUpdated,
                        calculatedFrom: 'stored_final_totals_auto'
                    }
                },
                { upsert: true }
            );
        }
        
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
 * Enhanced POST handler with refresh functionality
 */
export async function POST(request) {
    try {
        const data = await request.json();
        const { round, standings, forceRecalculate, calculateRoundSummary, refreshLadder } = data;
        
        if (!round) {
            return Response.json({ error: 'Invalid data: round is required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        // Handle refresh ladder request
        if (refreshLadder) {
            console.log(`Refreshing ladder for round ${round} - clearing database and recalculating ALL rounds from scratch`);
            
            // Clear all existing ladder data
            await db.collection(`${CURRENT_YEAR}_ladder`).deleteMany({});
            console.log('Cleared all existing ladder data from database');
            
            // Clear all existing calculated round results
            await db.collection(`${CURRENT_YEAR}_calculated_round_results`).deleteMany({});
            console.log('Cleared all existing calculated round results from database');
            
            // Build fresh ladder by calculating every single round from scratch
            const freshLadder = await buildLadderFromScratchCalculations(round, db);
            
            // Store ladders for ALL rounds from 1 to current round
            const ladderCollection = db.collection(`${CURRENT_YEAR}_ladder`);
            const bulkLadderOps = [];
            
            // Calculate and store ladder for each round up to current
            for (let r = 1; r <= round; r++) {
                console.log(`Storing ladder state for round ${r}`);
                
                // Calculate ladder up to round r
                const ladderUpToRound = await buildLadderFromStoredFinalTotals(r, db);
                
                bulkLadderOps.push({
                    updateOne: {
                        filter: { round: r },
                        update: { 
                            $set: { 
                                round: r, 
                                standings: ladderUpToRound, 
                                lastUpdated: new Date(), 
                                calculatedFrom: 'complete_refresh_from_scratch_calculations' 
                            } 
                        },
                        upsert: true
                    }
                });
            }
            
            // Execute all ladder storage operations
            if (bulkLadderOps.length > 0) {
                await ladderCollection.bulkWrite(bulkLadderOps);
                console.log(`Stored ladder states for rounds 1-${round}`);
            }
            
            return Response.json({ 
                success: true, 
                standings: freshLadder, 
                refreshed: true,
                message: `Ladder completely refreshed with fresh calculations for rounds 1-${round}, stored all intermediate ladders`
            });
        }
        
        // Handle round summary calculation
        if (calculateRoundSummary) {
            console.log(`Calculating round summary for round ${round}`);
            const summaryResult = await calculateAndStoreRoundSummary(round, db, forceRecalculate);
            return Response.json(summaryResult);
        }
        
        // Existing ladder recalculation logic
        if (forceRecalculate) {
            console.log(`Force recalculating ladder for round ${round}`);
            const freshLadder = await buildLadderFromStoredFinalTotals(round, db);
            
            await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
                { round: round },
                { $set: { round, standings: freshLadder, lastUpdated: new Date(), calculatedFrom: 'forced_recalculate' } },
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
 * Build ladder from complete scratch calculations using consolidated-round-results API
 * This ensures we use exactly the same calculations as the results page
 */
async function buildLadderFromScratchCalculations(currentRound, db) {
    console.log(`Building ladder from scratch using consolidated-round-results API for rounds 1-${currentRound}`);
    
    const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
        userId,
        userName,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        percentage: 0,
        points: 0
    }));

    // Fetch all rounds in parallel (batches of 5 to limit concurrency)
    const maxRound = Math.min(currentRound, 21);
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    const BATCH_SIZE = 5;

    for (let batchStart = 1; batchStart <= maxRound; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, maxRound);
        const roundNumbers = [];
        for (let r = batchStart; r <= batchEnd; r++) roundNumbers.push(r);

        console.log(`Fetching rounds ${batchStart}-${batchEnd} in parallel`);

        const batchResults = await Promise.all(roundNumbers.map(async (round) => {
            try {
                const response = await fetch(`${baseUrl}/api/consolidated-round-results?round=${round}`);
                if (!response.ok) {
                    console.warn(`Failed to get consolidated results for round ${round}: ${response.status}`);
                    return { round, roundResults: null };
                }
                const data = await response.json();
                return { round, roundResults: data.results || {} };
            } catch (error) {
                console.error(`Error fetching round ${round}:`, error);
                return { round, roundResults: null };
            }
        }));

        // Process each round's results sequentially (order matters for DB writes)
        for (const { round, roundResults } of batchResults) {
            if (!roundResults || Object.keys(roundResults).length === 0) {
                console.log(`No results for round ${round}, skipping`);
                continue;
            }

            console.log(`Got consolidated results for round ${round}: ${Object.keys(roundResults).length} users`);

            // Store the results we got from the API
            await storeRoundResultsFromAPI(round, roundResults, db);
            await storeFinalTotalsFromAPI(round, roundResults, db);

            // Update ladder with this round's results
            const fixtures = getFixturesForRound(round);

            fixtures.forEach((fixture) => {
                const homeUserId = String(fixture.home);
                const awayUserId = String(fixture.away);

                const homeResult = roundResults[homeUserId];
                const awayResult = roundResults[awayUserId];

                if (!homeResult || !awayResult) {
                    console.log(`Round ${round}: Missing results for ${USER_NAMES[homeUserId]} vs ${USER_NAMES[awayUserId]}, skipping`);
                    return;
                }

                const homeScore = homeResult.totalScore || 0;
                const awayScore = awayResult.totalScore || 0;

                // Skip if both scores are 0
                if (homeScore === 0 && awayScore === 0) {
                    console.log(`Round ${round}: No scores for ${USER_NAMES[homeUserId]} vs ${USER_NAMES[awayUserId]}, skipping`);
                    return;
                }

                console.log(`Round ${round}: ${USER_NAMES[homeUserId]} (${homeScore}) vs ${USER_NAMES[awayUserId]} (${awayScore})`);

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
                    } else if (awayScore > homeScore) {
                        awayLadder.wins++;
                        awayLadder.points += 4;
                        homeLadder.losses++;
                    } else {
                        homeLadder.draws++;
                        homeLadder.points += 2;
                        awayLadder.draws++;
                        awayLadder.points += 2;
                    }
                }
            });
        }
    }

    // Calculate percentages
    ladder.forEach(team => {
        team.percentage = team.pointsAgainst === 0
            ? (team.pointsFor > 0 ? Number((team.pointsFor * 100).toFixed(2)) : 0)
            : Number(((team.pointsFor / team.pointsAgainst) * 100).toFixed(2));
    });

    // Sort ladder by points, then percentage
    const sortedLadder = ladder.sort((a, b) => b.points - a.points || parseFloat(b.percentage) - parseFloat(a.percentage));
    
    console.log(`Complete ladder calculation finished using consolidated-round-results API for rounds 1-${currentRound}`);
    return sortedLadder;
}

/**
 * Build ladder using stored Final Totals (for regular GET requests)
 */
async function buildLadderFromStoredFinalTotals(currentRound, db, year = CURRENT_YEAR) {
    console.log(`Building ladder from stored Final Totals for round ${currentRound} (year ${year})`);
    
    const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
        userId,
        userName,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        percentage: 0,
        points: 0
    }));

    // Process rounds 1 through currentRound
    for (let round = 1; round <= Math.min(currentRound, 21); round++) {
        const finalTotals = await getStoredFinalTotals(round, db, year);

        if (!finalTotals || Object.keys(finalTotals).length === 0) {
            console.log(`No stored Final Totals available for round ${round}, skipping`);
            continue;
        }

        const fixtures = getFixturesForRound(round);

        fixtures.forEach((fixture) => {
            const homeUserId = String(fixture.home);
            const awayUserId = String(fixture.away);
            
            const homeScore = finalTotals[homeUserId] || 0;
            const awayScore = finalTotals[awayUserId] || 0;
            
            if (homeScore === 0 && awayScore === 0) return;
            
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
                } else if (awayScore > homeScore) {
                    awayLadder.wins++;
                    awayLadder.points += 4;
                    homeLadder.losses++;
                } else {
                    homeLadder.draws++;
                    homeLadder.points += 2;
                    awayLadder.draws++;
                    awayLadder.points += 2;
                }
            }
        });
    }

    // Calculate percentages
    ladder.forEach(team => {
        team.percentage = team.pointsAgainst === 0
            ? (team.pointsFor > 0 ? Number((team.pointsFor * 100).toFixed(2)) : 0)
            : Number(((team.pointsFor / team.pointsAgainst) * 100).toFixed(2));
    });

    return ladder.sort((a, b) => b.points - a.points || parseFloat(b.percentage) - parseFloat(a.percentage));
}

/**
 * Calculate round results for all users
 */
async function calculateRoundResults(round, db) {
    console.log(`Calculating round results for all users in round ${round}`);
    
    const results = {};
    
    for (const userId of Object.keys(USER_NAMES)) {
        try {
            const userResult = await getUserRoundResult(round, userId, db);
            results[userId] = userResult;
        } catch (error) {
            console.error(`Error calculating result for user ${userId} round ${round}:`, error);
            results[userId] = { userId, totalScore: 0, playerScore: 0, deadCertScore: 0 };
        }
    }
    
    return results;
}

/**
 * Calculate user round result using same logic as consolidated-round-results API
 */
async function getUserRoundResult(round, userId, db) {
    try {
        // Get team selection
        const teamSelection = await db.collection(`${CURRENT_YEAR}_team_selection`)
            .find({ 
                Round: round,
                User: parseInt(userId),
                Active: 1 
            })
            .toArray();

        // Get player stats
        const playerStats = await db.collection(`${CURRENT_YEAR}_game_results`)
            .find({ round: round })
            .toArray();

        if (!teamSelection || teamSelection.length === 0) {
            console.log(`No team selection found for user ${userId} round ${round}`);
            return { userId, totalScore: 0, playerScore: 0, deadCertScore: 0 };
        }

        // Calculate team scores (simplified version)
        const teamScoreData = calculateBasicTeamScores(teamSelection, playerStats);
        const playerScore = teamScoreData.totalScore;

        // Calculate dead cert score
        let deadCertScore = 0;
        try {
            deadCertScore = await calculateDeadCertScore(db, round, userId);
        } catch (error) {
            console.error(`Error calculating dead cert score for user ${userId} round ${round}:`, error);
            deadCertScore = 0;
        }

        const totalScore = playerScore + deadCertScore;

        console.log(`User ${userId} round ${round}: Player score ${playerScore}, Dead cert ${deadCertScore}, Total ${totalScore}`);

        return {
            userId,
            playerScore,
            deadCertScore,
            totalScore
        };

    } catch (error) {
        console.error(`Error calculating result for user ${userId} round ${round}:`, error);
        return { userId, totalScore: 0, playerScore: 0, deadCertScore: 0 };
    }
}

/**
 * Basic team score calculation (simplified version without substitutions)
 */
function calculateBasicTeamScores(teamSelection, playerStats) {
    // Create player stats map
    const statsMap = {};
    playerStats.forEach(stat => {
        statsMap[stat.player_name] = stat;
    });
    
    let totalScore = 0;
    
    teamSelection.forEach(selection => {
        if (selection.Position === 'Bench' || selection.Position.startsWith('Reserve')) {
            return; // Skip bench/reserves for basic calculation
        }
        
        const playerStat = statsMap[selection.Player_Name];
        if (!playerStat) {
            return; // Skip if no stats found
        }
        
        // Basic scoring calculation (simplified)
        const score = (playerStat.kicks || 0) + 
                     (playerStat.handballs || 0) + 
                     (playerStat.marks || 0) + 
                     (playerStat.tackles || 0) + 
                     (playerStat.hitouts || 0) + 
                     ((playerStat.goals || 0) * 6) + 
                     (playerStat.behinds || 0);
        
        totalScore += score;
    });
    
    return { totalScore };
}

/**
 * Calculate dead cert score using same logic as tipping-results API
 */
async function calculateDeadCertScore(db, round, userId) {
    try {
        console.log(`Calculating dead cert score for user ${userId} round ${round}`);
        
        // Get fixtures for this round (cached in memory)
        const fixtures = await getAflFixtures();
        
        // Filter completed matches for the round
        const completedMatches = fixtures.filter(match => 
            match.RoundNumber.toString() === round.toString() &&
            match.HomeTeamScore !== null &&
            match.AwayTeamScore !== null
        );

        if (completedMatches.length === 0) {
            return 0;
        }

        // Get tips from database
        const tips = await db.collection(`${CURRENT_YEAR}_tips`)
            .find({ 
                Round: parseInt(round),
                User: parseInt(userId),
                Active: 1 
            }).toArray();

        // Calculate dead cert score
        let deadCertScore = 0;
        
        completedMatches.forEach(match => {
            const tip = tips.find(t => t.MatchNumber === match.MatchNumber);
            
            const winningTeam = match.HomeTeamScore > match.AwayTeamScore 
                ? match.HomeTeam 
                : match.AwayTeamScore > match.HomeTeamScore 
                    ? match.AwayTeam 
                    : 'Draw';
            
            let tipTeam = tip ? tip.Team : match.HomeTeam;
            let isDeadCert = tip ? tip.DeadCert : false;
            
            const isCorrect = tipTeam === winningTeam;
            
            if (isCorrect && isDeadCert) {
                deadCertScore += 6;
            } else if (!isCorrect && isDeadCert) {
                deadCertScore -= 12;
            }
        });
        
        return deadCertScore;
        
    } catch (error) {
        console.error(`Error calculating dead cert score for user ${userId} round ${round}:`, error);
        return 0;
    }
}

/**
 * Store round results from consolidated-round-results API
 */
async function storeRoundResultsFromAPI(round, roundResults, db) {
    try {
        console.log(`Storing round results from API for round ${round}`);
        
        const collection = db.collection(`${CURRENT_YEAR}_calculated_round_results`);
        
        const bulkOps = Object.entries(roundResults).map(([userId, result]) => ({
            updateOne: {
                filter: { round: round, userId: userId },
                update: { 
                    $set: { 
                        round: round,
                        userId: userId,
                        playerScore: result.playerScore || 0,
                        deadCertScore: result.deadCertScore || 0,
                        totalScore: result.totalScore || 0,
                        matchResult: result.matchResult || null,
                        opponent: result.opponent || null,
                        opponentScore: result.opponentScore || 0,
                        isHome: result.isHome || false,
                        hasStar: result.hasStar || false,
                        hasCrab: result.hasCrab || false,
                        calculatedAt: new Date(),
                        source: 'consolidated_round_results_api'
                    } 
                },
                upsert: true
            }
        }));
        
        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps);
            console.log(`Stored ${bulkOps.length} round results from API for round ${round}`);
        }
        
    } catch (error) {
        console.error(`Error storing round results from API for round ${round}:`, error);
    }
}

/**
 * Store Final Totals from consolidated-round-results API
 */
async function storeFinalTotalsFromAPI(round, roundResults, db) {
    try {
        console.log(`Storing Final Totals from API for round ${round}`);
        
        const collection = db.collection(`${CURRENT_YEAR}_final_totals`);
        
        const bulkOps = Object.entries(roundResults).map(([userId, result]) => ({
            updateOne: {
                filter: { round: round, userId: userId },
                update: { 
                    $set: { 
                        round: round,
                        userId: userId,
                        teamScore: result.playerScore || 0,
                        deadCertScore: result.deadCertScore || 0,
                        finalTotal: result.totalScore || 0,
                        lastUpdated: new Date(),
                        source: 'ladder_refresh_via_consolidated_api'
                    } 
                },
                upsert: true
            }
        }));
        
        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps);
            console.log(`Stored Final Totals from API for round ${round}`);
        }
        
    } catch (error) {
        console.error(`Error storing Final Totals from API for round ${round}:`, error);
    }
}

/**
 * Get Final Totals stored in database
 */
async function getStoredFinalTotals(round, db, year = CURRENT_YEAR) {
    try {
        const results = await db.collection(`${year}_final_totals`)
            .find({ round: round })
            .toArray();
        
        if (!results || results.length === 0) {
            return {};
        }
        
        const finalTotals = {};
        results.forEach(result => {
            if (result.userId && result.finalTotal !== undefined) {
                finalTotals[result.userId] = result.finalTotal || 0;
            }
        });
        
        return finalTotals;
        
    } catch (error) {
        console.error(`Error getting stored Final Totals for round ${round}:`, error);
        return {};
    }
}

/**
 * Handle GET requests for round summary data
 */
async function handleGetRoundSummary(round, db, year = CURRENT_YEAR) {
    try {
        if (!round) {
            return Response.json({ error: 'Round is required for summary request' }, { status: 400 });
        }

        const results = await db.collection(`${year}_round_summaries`)
            .find({ round: round })
            .toArray();
        
        const userResults = {};
        let roundSummary = null;
        
        results.forEach(result => {
            if (result.userId === 'ROUND_SUMMARY') {
                roundSummary = {
                    highestScore: result.highestScore,
                    lowestScore: result.lowestScore,
                    starWinners: result.starWinners,
                    crabWinners: result.crabWinners
                };
            } else if (result.userId) {
                userResults[result.userId] = {
                    score: result.score,
                    matchResult: result.matchResult,
                    opponent: result.opponent,
                    opponentScore: result.opponentScore,
                    isHome: result.isHome,
                    earnedStar: result.earnedStar,
                    earnedCrab: result.earnedCrab
                };
            }
        });
        
        return Response.json({
            found: results.length > 0,
            round,
            userResults,
            roundSummary
        });

    } catch (error) {
        console.error('API Error in GET round summary:', error);
        return Response.json({ error: 'Failed to get round summary' }, { status: 500 });
    }
}

/**
 * Calculate and store round summary data
 */
async function calculateAndStoreRoundSummary(round, db, forceRecalculate = false) {
    try {
        const collection = db.collection(`${CURRENT_YEAR}_round_summaries`);

        if (!forceRecalculate) {
            const existingCount = await collection.countDocuments({ round: round });
            if (existingCount > 0) {
                return { 
                    success: true, 
                    message: `Round summary already exists for round ${round}`,
                    skipped: true 
                };
            }
        }

        const finalTotals = await getStoredFinalTotals(round, db);
        
        if (!finalTotals || Object.keys(finalTotals).length === 0) {
            return { 
                success: false,
                error: `No Final Totals available for round ${round}` 
            };
        }

        const roundSummary = await calculateRoundSummaryData(round, finalTotals);

        const bulkOps = [];
        const lastUpdated = new Date();

        Object.entries(roundSummary.userResults).forEach(([userId, userData]) => {
            bulkOps.push({
                updateOne: {
                    filter: { round: round, userId: userId },
                    update: { 
                        $set: { 
                            round: round,
                            userId: userId,
                            score: userData.score,
                            matchResult: userData.matchResult,
                            opponent: userData.opponent,
                            opponentScore: userData.opponentScore,
                            isHome: userData.isHome,
                            earnedStar: userData.earnedStar,
                            earnedCrab: userData.earnedCrab,
                            lastUpdated: lastUpdated,
                            calculatedFrom: 'final_totals'
                        } 
                    },
                    upsert: true
                }
            });
        });

        bulkOps.push({
            updateOne: {
                filter: { round: round, userId: 'ROUND_SUMMARY' },
                update: { 
                    $set: { 
                        round: round,
                        userId: 'ROUND_SUMMARY',
                        highestScore: roundSummary.highestScore,
                        lowestScore: roundSummary.lowestScore,
                        starWinners: roundSummary.starWinners,
                        crabWinners: roundSummary.crabWinners,
                        lastUpdated: lastUpdated,
                        calculatedFrom: 'final_totals'
                    } 
                },
                upsert: true
            }
        });

        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps);
        }

        return { 
            success: true,
            message: `Calculated and stored round summary for round ${round}`,
            round,
            userCount: Object.keys(roundSummary.userResults).length
        };

    } catch (error) {
        console.error('Error calculating round summary:', error);
        return { 
            success: false, 
            error: 'Failed to calculate round summary: ' + error.message 
        };
    }
}

/**
 * Calculate comprehensive round summary data
 */
async function calculateRoundSummaryData(round, finalTotals) {
    const userResults = {};
    const fixtures = getFixturesForRound(round);
    
    // Initialize all users
    Object.keys(USER_NAMES).forEach(userId => {
        userResults[userId] = {
            score: finalTotals[userId] || 0,
            matchResult: null,
            opponent: null,
            opponentScore: 0,
            isHome: false,
            earnedStar: false,
            earnedCrab: false
        };
    });
    
    // Process fixtures
    fixtures.forEach(fixture => {
        const homeUserId = String(fixture.home);
        const awayUserId = String(fixture.away);
        
        const homeScore = finalTotals[homeUserId] || 0;
        const awayScore = finalTotals[awayUserId] || 0;
        
        if (homeScore === 0 && awayScore === 0) return;
        
        if (userResults[homeUserId]) {
            userResults[homeUserId].opponent = USER_NAMES[awayUserId];
            userResults[homeUserId].opponentScore = awayScore;
            userResults[homeUserId].isHome = true;
        }
        
        if (userResults[awayUserId]) {
            userResults[awayUserId].opponent = USER_NAMES[homeUserId];
            userResults[awayUserId].opponentScore = homeScore;
            userResults[awayUserId].isHome = false;
        }
        
        if (homeScore > awayScore) {
            if (userResults[homeUserId]) userResults[homeUserId].matchResult = 'W';
            if (userResults[awayUserId]) userResults[awayUserId].matchResult = 'L';
        } else if (awayScore > homeScore) {
            if (userResults[awayUserId]) userResults[awayUserId].matchResult = 'W';
            if (userResults[homeUserId]) userResults[homeUserId].matchResult = 'L';
        } else {
            if (userResults[homeUserId]) userResults[homeUserId].matchResult = 'D';
            if (userResults[awayUserId]) userResults[awayUserId].matchResult = 'D';
        }
    });
    
    // Calculate stars and crabs
    const scores = Object.entries(finalTotals)
        .map(([userId, score]) => ({ userId, score: Number(score) }))
        .filter(s => s.score > 0);
    
    let highestScore = 0;
    let lowestScore = 0;
    let starWinners = [];
    let crabWinners = [];
    
    if (scores.length > 0) {
        highestScore = Math.max(...scores.map(s => s.score));
        lowestScore = Math.min(...scores.map(s => s.score));
        
        starWinners = scores.filter(s => s.score === highestScore).map(s => s.userId);
        
        if (lowestScore < highestScore) {
            crabWinners = scores.filter(s => s.score === lowestScore).map(s => s.userId);
        }
        
        starWinners.forEach(userId => {
            if (userResults[userId]) {
                userResults[userId].earnedStar = true;
            }
        });
        
        crabWinners.forEach(userId => {
            if (userResults[userId]) {
                userResults[userId].earnedCrab = true;
            }
        });
    }
    
    return {
        userResults,
        highestScore,
        lowestScore,
        starWinners,
        crabWinners
    };
}

/**
 * DELETE handler to clear cached ladder data for a specific round
 */
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        const clearSummary = searchParams.get('clearSummary') === 'true';
        
        if (!round) {
            return Response.json({ error: 'Round parameter required' }, { status: 400 });
        }
        
        const { db } = await connectToDatabase();
        
        if (clearSummary) {
            const result = await db.collection(`${CURRENT_YEAR}_round_summaries`).deleteMany({ round: round });
            return Response.json({ 
                success: true, 
                message: `Cleared ${result.deletedCount} round summary records for round ${round}`
            });
        } else {
            const result = await db.collection(`${CURRENT_YEAR}_ladder`).deleteOne({ round: round });
            
            if (result.deletedCount === 0) {
                return Response.json({ success: true, message: `No cached ladder to clear for round ${round}` });
            }

            return Response.json({ success: true, message: `Cleared cached ladder for round ${round}` });
        }
        
    } catch (error) {
        console.error('API Error in DELETE /api/ladder:', error);
        return Response.json({ error: 'Failed to clear ladder data' }, { status: 500 });
    }
}
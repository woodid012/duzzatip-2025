// src/app/api/simple-ladder/route.js

import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

/**
 * GET - Retrieve ladder data from stored round results
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const upToRound = parseInt(searchParams.get('round')) || 21;
        
        const { db } = await connectToDatabase();
        
        console.log(`Building ladder up to round ${upToRound}`);
        
        // Initialize ladder
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
        
        // Get stored round results from database
        const maxRound = Math.min(upToRound, 21); // Cap at round 21 for regular season
        
        for (let round = 1; round <= maxRound; round++) {
            // Get stored results for this round
            const storedResults = await db.collection(`${CURRENT_YEAR}_simple_round_results`)
                .findOne({ round: round });
            
            if (!storedResults || !storedResults.results) {
                console.log(`No stored results for round ${round}`);
                continue;
            }
            
            // Get fixtures for this round
            const fixtures = getFixturesForRound(round);
            
            // Process each fixture
            fixtures.forEach(fixture => {
                const homeUserId = String(fixture.home);
                const awayUserId = String(fixture.away);
                
                const homeScore = storedResults.results[homeUserId]?.totalScore || 0;
                const awayScore = storedResults.results[awayUserId]?.totalScore || 0;
                
                // Skip if both scores are 0
                if (homeScore === 0 && awayScore === 0) {
                    return;
                }
                
                // Find ladder entries
                const homeLadder = ladder.find(entry => entry.userId === homeUserId);
                const awayLadder = ladder.find(entry => entry.userId === awayUserId);
                
                if (homeLadder && awayLadder) {
                    // Update games played
                    homeLadder.played += 1;
                    awayLadder.played += 1;
                    
                    // Update points for/against
                    homeLadder.pointsFor += homeScore;
                    homeLadder.pointsAgainst += awayScore;
                    awayLadder.pointsFor += awayScore;
                    awayLadder.pointsAgainst += homeScore;
                    
                    // Update wins/losses/draws and ladder points
                    if (homeScore > awayScore) {
                        homeLadder.wins += 1;
                        homeLadder.points += 4;
                        awayLadder.losses += 1;
                    } else if (awayScore > homeScore) {
                        awayLadder.wins += 1;
                        awayLadder.points += 4;
                        homeLadder.losses += 1;
                    } else {
                        homeLadder.draws += 1;
                        homeLadder.points += 2;
                        awayLadder.draws += 1;
                        awayLadder.points += 2;
                    }
                }
            });
        }
        
        // Calculate percentages
        ladder.forEach(team => {
            team.percentage = team.pointsAgainst === 0 
                ? (team.pointsFor > 0 ? (team.pointsFor * 100).toFixed(2) : '0.00')
                : ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
        });
        
        // Sort ladder by points, then percentage
        const sortedLadder = ladder.sort((a, b) => {
            if (b.points !== a.points) {
                return b.points - a.points;
            }
            return parseFloat(b.percentage) - parseFloat(a.percentage);
        });
        
        // Get last update time
        const lastUpdate = await db.collection(`${CURRENT_YEAR}_simple_round_results`)
            .findOne({}, { sort: { lastUpdated: -1 } });
        
        return Response.json({
            ladder: sortedLadder,
            lastUpdated: lastUpdate?.lastUpdated || null,
            upToRound: maxRound
        });
        
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
        const { round, refreshAll } = await request.json();
        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_simple_round_results`);
        
        if (refreshAll) {
            // Refresh all rounds 1-21
            console.log('Refreshing all rounds 1-21...');
            
            const results = {
                processed: [],
                failed: [],
                stored: []
            };
            
            for (let r = 1; r <= 21; r++) {
                console.log(`Processing round ${r}...`);
                
                try {
                    // Fetch from consolidated-round-results API
                    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
                    const response = await fetch(`${baseUrl}/api/consolidated-round-results?round=${r}`);
                    
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
            const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
            const response = await fetch(`${baseUrl}/api/consolidated-round-results?round=${round}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch round ${round} data`);
            }
            
            const data = await response.json();
            
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
                { round: round },
                { 
                    $set: { 
                        round: round,
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
        const { searchParams } = new URL(request.url);
        const round = searchParams.get('round');
        
        const { db } = await connectToDatabase();
        
        if (round) {
            // Delete specific round
            await db.collection(`${CURRENT_YEAR}_simple_round_results`)
                .deleteOne({ round: parseInt(round) });
            
            return Response.json({ 
                success: true, 
                message: `Cleared round ${round}` 
            });
        } else {
            // Delete all rounds
            const result = await db.collection(`${CURRENT_YEAR}_simple_round_results`)
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
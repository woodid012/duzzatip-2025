import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

/**
 * GET handler for ladder data.
 * Gets the Final Total directly from the database (stored by results page)
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 0;
        
        const { db } = await connectToDatabase();
        
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
        
        // If cache is missing or stale, build ladder from Final Totals stored in database
        console.log(`Building fresh ladder from stored Final Totals for round ${round}`);
        const calculatedLadder = await buildLadderFromStoredFinalTotals(round, db);
        
        const lastUpdated = new Date();

        // Save the newly calculated ladder to the cache
        await ladderCollection.updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    standings: calculatedLadder,
                    lastUpdated: lastUpdated,
                    calculatedFrom: 'stored_final_totals_direct'
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
 * Build ladder using Final Totals stored directly in database by results page
 * This gets the exact same values that show as "Final Total" on the results page
 */
async function buildLadderFromStoredFinalTotals(currentRound, db) {
    console.log(`Building ladder from stored Final Totals for round ${currentRound}`);
    
    const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
        userId, userName, played: 0, wins: 0, losses: 0, draws: 0,
        pointsFor: 0, pointsAgainst: 0, percentage: 0, points: 0
    }));

    // Process rounds 1 through currentRound (up to 21 for regular season)
    for (let round = 1; round <= Math.min(currentRound, 21); round++) {
        console.log(`Getting stored Final Totals for round ${round}`);
        
        // Get Final Totals directly from database (stored by results page)
        const finalTotals = await getStoredFinalTotals(round, db);
        
        if (!finalTotals || Object.keys(finalTotals).length === 0) {
            console.log(`No stored Final Totals available for round ${round}, skipping`);
            continue;
        }
        
        console.log(`Using Final Totals for round ${round}:`, finalTotals);
        
        const fixtures = getFixturesForRound(round);
        
        fixtures.forEach((fixture) => {
            const homeUserId = String(fixture.home);
            const awayUserId = String(fixture.away);
            
            const homeScore = finalTotals[homeUserId] || 0;
            const awayScore = finalTotals[awayUserId] || 0;
            
            // Skip if both scores are 0 (no data)
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

    // Calculate percentages
    ladder.forEach(team => {
        team.percentage = team.pointsAgainst === 0 
            ? (team.pointsFor > 0 ? (team.pointsFor * 100).toFixed(2) : '0.00')
            : ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
    });

    // Sort ladder by points, then percentage
    const sortedLadder = ladder.sort((a, b) => b.points - a.points || b.percentage - a.percentage);
    
    console.log(`Ladder complete for round ${currentRound} using stored Final Totals`);
    return sortedLadder;
}

/**
 * Get the Final Totals stored directly in database by the results page
 * This avoids any API call issues and gets data directly from the same source
 */
async function getStoredFinalTotals(round, db) {
    console.log(`Getting stored Final Totals from database for round ${round}`);
    
    try {
        const finalTotalsCollection = db.collection(`${CURRENT_YEAR}_final_totals`);
        
        // Get all Final Totals for this round
        const results = await finalTotalsCollection
            .find({ round: round })
            .toArray();
        
        if (!results || results.length === 0) {
            console.log(`No Final Totals found in database for round ${round}`);
            return {};
        }
        
        // Convert to the expected format
        const finalTotals = {};
        results.forEach(result => {
            if (result.userId && result.finalTotal !== undefined) {
                finalTotals[result.userId] = result.finalTotal || 0;
            }
        });
        
        console.log(`Retrieved Final Totals from database for round ${round}:`, finalTotals);
        return finalTotals;
        
    } catch (error) {
        console.error(`Error getting stored Final Totals for round ${round}:`, error);
        return {};
    }
}

/**
 * POST handler to store/update ladder data (for manual overrides or force recalculation).
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
            console.log(`Force recalculating ladder for round ${round} using stored Final Totals`);
            const freshLadder = await buildLadderFromStoredFinalTotals(round, db);
            
            await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
                { round: round },
                { $set: { round, standings: freshLadder, lastUpdated: new Date(), calculatedFrom: 'forced_stored_final_totals' } },
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
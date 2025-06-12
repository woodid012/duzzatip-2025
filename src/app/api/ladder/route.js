import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

/**
 * GET handler for ladder data.
 * Gets the Final Total directly from the results page without any calculation
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
        
        // If cache is missing or stale, get Final Totals from results page and build ladder
        console.log(`Getting Final Totals from results page for round ${round}`);
        const calculatedLadder = await buildLadderFromResultsPageFinalTotals(round);
        
        const lastUpdated = new Date();

        // Save the newly calculated ladder to the cache
        await ladderCollection.updateOne(
            { round: round },
            { 
                $set: { 
                    round: round,
                    standings: calculatedLadder,
                    lastUpdated: lastUpdated,
                    calculatedFrom: 'results_page_final_totals_direct'
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
 * Build ladder using Final Totals from results page - NO CALCULATION
 * Just gets the Final Total values and uses them for ladder standings
 */
async function buildLadderFromResultsPageFinalTotals(currentRound) {
    console.log(`Building ladder from results page Final Totals for round ${currentRound}`);
    
    const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
        userId, userName, played: 0, wins: 0, losses: 0, draws: 0,
        pointsFor: 0, pointsAgainst: 0, percentage: 0, points: 0
    }));

    for (let round = 1; round <= Math.min(currentRound, 21); round++) {
        console.log(`Getting Final Totals for round ${round} from results page`);
        
        // Get the Final Totals that are already calculated on the results page
        const finalTotals = await getFinalTotalsFromResultsPage(round);
        
        if (!finalTotals || Object.keys(finalTotals).length === 0) {
            console.log(`No Final Totals available for round ${round}, skipping`);
            continue;
        }
        
        const fixtures = getFixturesForRound(round);
        
        fixtures.forEach((fixture) => {
            const homeUserId = String(fixture.home);
            const awayUserId = String(fixture.away);
            
            const homeScore = finalTotals[homeUserId] || 0;
            const awayScore = finalTotals[awayUserId] || 0;
            
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

    ladder.forEach(team => {
        team.percentage = team.pointsAgainst === 0 
            ? (team.pointsFor > 0 ? (team.pointsFor * 100).toFixed(2) : '0.00')
            : ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
    });

    const sortedLadder = ladder.sort((a, b) => b.points - a.points || b.percentage - a.percentage);
    
    console.log(`Ladder complete for round ${currentRound} using results page Final Totals`);
    return sortedLadder;
}

/**
 * Get the Final Totals that are stored by the results page
 * This gets the exact same values that show as "Final Total" on the results page
 */
async function getFinalTotalsFromResultsPage(round) {
    console.log(`Getting stored Final Totals from results page for round ${round}`);
    
    try {
        // Get all Final Totals for this round that were stored by the results page
        const response = await fetch(`${getBaseUrl()}/api/final-totals?round=${round}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`Got Final Totals for round ${round}:`, data.finalTotals);
            return data.finalTotals || {};
        } else {
            console.warn(`Failed to get Final Totals for round ${round}`);
            return {};
        }
        
    } catch (error) {
        console.error(`Error in getFinalTotalsFromResultsPage for round ${round}:`, error);
        return {};
    }
}

/**
 * Get the base URL for internal API calls
 */
function getBaseUrl() {
    return process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
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
            console.log(`Force recalculating ladder for round ${round} using results page Final Totals`);
            const freshLadder = await buildLadderFromResultsPageFinalTotals(round);
            
            await db.collection(`${CURRENT_YEAR}_ladder`).updateOne(
                { round: round },
                { $set: { round, standings: freshLadder, lastUpdated: new Date(), calculatedFrom: 'forced_results_page_final_totals' } },
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
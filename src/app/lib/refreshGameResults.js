// Shared AFL player-stats fetcher + game_results updater.
// Used by:
//   - /api/update-round-stats route (explicit refresh)
//   - fixtureCache.js (auto-refresh when fixture scores newly land)

import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership

async function getAFLToken() {
    const res = await fetch("https://api.afl.com.au/cfs/afl/WMCTok", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": "https://www.afl.com.au" },
        body: "{}",
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`AFL token fetch failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.token;
}

export async function fetchAFLRoundStats(round, providedToken = null) {
    const token = providedToken || await getAFLToken();
    const headers = { "x-media-mis-token": token };

    const matchesRes = await fetch(
        `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${round}&pageSize=20`,
        { headers, signal: AbortSignal.timeout(10000) }
    );
    const matchesData = await matchesRes.json();
    const matches = matchesData.matches || [];

    if (matches.length === 0) {
        throw new Error(`No matches found for round ${round} from AFL API`);
    }

    const allPlayers = [];

    await Promise.all(matches.map(async (match) => {
        const providerId = match.providerId;
        if (!providerId) return;

        const homeTeamName = match.home?.team?.name || '';
        const awayTeamName = match.away?.team?.name || '';

        const statsRes = await fetch(
            `https://api.afl.com.au/cfs/afl/playerStats/match/${providerId}`,
            { headers, signal: AbortSignal.timeout(10000) }
        );
        if (!statsRes.ok) return;
        const statsData = await statsRes.json();

        for (const side of ['homeTeamPlayerStats', 'awayTeamPlayerStats']) {
            const isHome = side === 'homeTeamPlayerStats';
            const teamName = isHome ? homeTeamName : awayTeamName;
            const opponent = isHome ? awayTeamName : homeTeamName;
            const players = statsData[side] || [];

            for (const p of players) {
                const playerName_ = p.player?.player?.player?.playerName;
                const stats = p.playerStats?.stats;
                if (!playerName_ || !stats) continue;

                const playerName = `${playerName_.givenName} ${playerName_.surname}`;
                const ext = stats.extendedStats || {};

                allPlayers.push({
                    player_name: playerName,
                    team_name: teamName,
                    opp: opponent,
                    round: round,
                    year: CURRENT_YEAR,
                    match_date: match.utcStartTime ? match.utcStartTime.split('T')[0] : new Date().toISOString().split('T')[0],
                    kicks: Number(stats.kicks) || 0,
                    handballs: Number(stats.handballs) || 0,
                    disposals: Number(stats.disposals) || 0,
                    marks: Number(stats.marks) || 0,
                    tackles: Number(stats.tackles) || 0,
                    hitouts: Number(stats.hitouts) || 0,
                    freesFor: Number(stats.freesFor) || 0,
                    freesAgainst: Number(stats.freesAgainst) || 0,
                    goals: Number(stats.goals) || 0,
                    behinds: Number(stats.behinds) || 0,
                    centreBounceAttendances: Number(ext.centreBounceAttendances) || 0,
                    kickIns: Number(ext.kickins) || 0,
                    kickInsPlayon: Number(ext.kickinsPlayon) || 0,
                    timeOnGroundPercentage: Number(stats.timeOnGroundPercentage) || 0,
                    dreamTeamPoints: Number(stats.dreamTeamPoints) || 0,
                    SC: 0,
                    match_number: match.matchId || (100 + round),
                    startingPosition: '',
                    created_at: new Date(),
                });
            }
        }
    }));

    if (allPlayers.length === 0) {
        throw new Error(`AFL API returned 0 player stats for round ${round}`);
    }

    return allPlayers;
}

export async function updateGameResults(statsData, round) {
    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_game_results`);
    const processedData = statsData.filter(r => r && typeof r === 'object');
    await collection.deleteMany({ round: round, year: CURRENT_YEAR });
    const result = await collection.insertMany(processedData);
    return { insertedCount: result.insertedCount };
}

// Per-process throttle so the auto-refresh from fixtureCache doesn't hammer
// the AFL API when many requests land in quick succession.
const inFlight = new Map();      // round -> Promise
const lastRun = new Map();       // round -> timestamp
const THROTTLE_MS = 5 * 60 * 1000;

/**
 * Best-effort refresh. Returns immediately if a refresh ran in the last 5 min
 * for this round. Coalesces concurrent callers onto the same in-flight promise.
 */
export async function refreshGameResultsForRound(round, { token = null, force = false } = {}) {
    if (!force) {
        const last = lastRun.get(round);
        if (last && Date.now() - last < THROTTLE_MS) {
            return { skipped: true, reason: 'throttled' };
        }
    }
    if (inFlight.has(round)) return inFlight.get(round);

    const p = (async () => {
        try {
            const stats = await fetchAFLRoundStats(round, token);
            const { insertedCount } = await updateGameResults(stats, round);
            lastRun.set(round, Date.now());
            console.log(`[auto] Refreshed game_results round ${round}: ${insertedCount} records`);
            return { insertedCount };
        } catch (err) {
            console.warn(`[auto] game_results refresh round ${round} failed: ${err.message}`);
            return { error: err.message };
        } finally {
            inFlight.delete(round);
        }
    })();

    inFlight.set(round, p);
    return p;
}

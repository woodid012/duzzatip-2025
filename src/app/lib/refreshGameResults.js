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

export async function fetchAFLRoundStats(round, providedToken = null, { liveOnly = false } = {}) {
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
        // liveOnly (used by the manual refresh): skip CONCLUDED games — their
        // stats are final and won't change, so re-fetching them is wasted time.
        if (liveOnly && match.status === 'CONCLUDED') return;

        // Use the stable English club name, not team.name (which rotates
        // through Indigenous-language variants like Walyalup / Narrm). The
        // results page keys "game started" lookups off the fixture's English
        // team name, so storing the Indigenous variant here would break the
        // match and show players as "Game not started".
        const homeTeamName = match.home?.team?.club?.name || match.home?.team?.name || '';
        const awayTeamName = match.away?.team?.club?.name || match.away?.team?.name || '';

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

    // In liveOnly mode an empty result is legitimate (e.g. all games concluded,
    // or none live yet) — return [] rather than throwing.
    if (allPlayers.length === 0 && !liveOnly) {
        throw new Error(`AFL API returned 0 player stats for round ${round}`);
    }

    return allPlayers;
}

// Guard against a degraded AFL API response wiping good data. Within a round
// the stored record count only ever grows as games are played, so an empty or
// drastically smaller incoming set signals a bad response — not real data — and
// must not be allowed to replace what's already there. Returns true when the
// incoming set should be rejected.
export function isSuspectRefresh(existingCount, newCount) {
    if (newCount === 0) return existingCount > 0;
    return existingCount > 0 && newCount < existingCount * 0.5;
}

export async function updateGameResults(statsData, round, { merge = false } = {}) {
    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_game_results`);
    const processedData = statsData.filter(r => r && typeof r === 'object');

    // Merge mode (liveOnly refresh): only replace the teams we actually fetched
    // fresh stats for — leaving already-stored CONCLUDED games untouched. We
    // never delete a team's rows unless we have new rows to put back, so a
    // degraded response can't wipe data, and the global suspect-shrink guard
    // (which assumes a full replace) doesn't apply.
    if (merge) {
        if (processedData.length === 0) {
            return { insertedCount: 0, skipped: true, reason: 'nothing_live' };
        }
        const teams = [...new Set(processedData.map(r => r.team_name).filter(Boolean))];
        await collection.deleteMany({ round, year: CURRENT_YEAR, team_name: { $in: teams } });
        const result = await collection.insertMany(processedData);
        return { insertedCount: result.insertedCount, merged: true, teams: teams.length };
    }

    // Full replace: never let a partial/degraded refresh replace a fuller stored set.
    const existingCount = await collection.countDocuments({ round, year: CURRENT_YEAR });
    if (isSuspectRefresh(existingCount, processedData.length)) {
        console.warn(
            `[guard] Skipping round ${round} game_results overwrite: ` +
            `${processedData.length} incoming vs ${existingCount} stored — suspect AFL response.`
        );
        return { insertedCount: 0, skipped: true, reason: 'suspect_shrink', existingCount, newCount: processedData.length };
    }

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
export async function refreshGameResultsForRound(round, { token = null, force = false, liveOnly = false } = {}) {
    if (!force) {
        const last = lastRun.get(round);
        if (last && Date.now() - last < THROTTLE_MS) {
            return { skipped: true, reason: 'throttled' };
        }
    }
    if (inFlight.has(round)) return inFlight.get(round);

    const p = (async () => {
        try {
            const stats = await fetchAFLRoundStats(round, token, { liveOnly });
            const { insertedCount } = await updateGameResults(stats, round, { merge: liveOnly });
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

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

// Map one match's AFL playerStats payload into game_results rows (one per
// player). Shared by the full round fetch and the stale-game re-pull so the
// stored shape is identical. Uses the stable English club name, not team.name
// (which rotates through Indigenous-language variants like Walyalup / Narrm) —
// the results page keys "game started" lookups off the English fixture name, so
// storing the Indigenous variant would show players as "Game not started".
export function mapMatchPlayers(statsData, match, round) {
    const homeTeamName = match.home?.team?.club?.name || match.home?.team?.name || '';
    const awayTeamName = match.away?.team?.club?.name || match.away?.team?.name || '';
    const rows = [];
    for (const side of ['homeTeamPlayerStats', 'awayTeamPlayerStats']) {
        const isHome = side === 'homeTeamPlayerStats';
        const teamName = isHome ? homeTeamName : awayTeamName;
        const opponent = isHome ? awayTeamName : homeTeamName;
        for (const p of (statsData[side] || [])) {
            const playerName_ = p.player?.player?.player?.playerName;
            const stats = p.playerStats?.stats;
            if (!playerName_ || !stats) continue;
            const ext = stats.extendedStats || {};
            rows.push({
                player_name: `${playerName_.givenName} ${playerName_.surname}`,
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
    return rows;
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

        const statsRes = await fetch(
            `https://api.afl.com.au/cfs/afl/playerStats/match/${providerId}`,
            { headers, signal: AbortSignal.timeout(10000) }
        );
        if (!statsRes.ok) return;
        const statsData = await statsRes.json();
        allPlayers.push(...mapMatchPlayers(statsData, match, round));
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

// Unique index that makes the delete+insert refresh paths idempotent under
// concurrency: two writers racing on the same round can no longer double-insert
// a player's row (the historical cause of duplicate game_results). Partial so
// preseason (round 0, where a player can feature in multiple practice matches)
// stays unconstrained. Ensured once per process per collection; createIndex is a
// no-op when the index already exists.
const ensuredIndexCollections = new Set();
async function ensureGameResultsIndexes(collection) {
    const key = collection.collectionName;
    if (ensuredIndexCollections.has(key)) return;
    ensuredIndexCollections.add(key); // mark first so a slow build doesn't re-trigger
    try {
        await collection.createIndex(
            { year: 1, round: 1, player_name: 1, match_number: 1 },
            { unique: true, partialFilterExpression: { round: { $gte: 1 } }, name: 'uniq_year_round_player_match' }
        );
    } catch (err) {
        // Likely pre-existing duplicates in a historical collection — log and
        // carry on; inserts still work, just without the guard for that year.
        ensuredIndexCollections.delete(key);
        console.warn(`[index] ensure uniq game_results index failed (${key}): ${err.message}`);
    }
}

// insertMany that tolerates the unique-index guard: under a concurrent race some
// rows may already exist (E11000). With ordered:false the rest still insert; we
// swallow ONLY duplicate-key errors and rethrow anything genuine.
async function insertManyTolerant(collection, docs) {
    if (!docs.length) return { insertedCount: 0 };
    try {
        const r = await collection.insertMany(docs, { ordered: false });
        return { insertedCount: r.insertedCount };
    } catch (err) {
        const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : [];
        const onlyDup = writeErrors.length > 0 ? writeErrors.every(e => e.code === 11000) : err.code === 11000;
        if (onlyDup) {
            console.warn(`[dedup-guard] tolerated ${writeErrors.length || 1} duplicate-key row(s) on ${collection.collectionName} insert`);
            return { insertedCount: err.result?.insertedCount ?? err.insertedCount ?? 0 };
        }
        throw err;
    }
}

export async function updateGameResults(statsData, round, { merge = false } = {}) {
    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_game_results`);
    await ensureGameResultsIndexes(collection);
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
        const result = await insertManyTolerant(collection, processedData);
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
    const result = await insertManyTolerant(collection, processedData);
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

// Separate throttle + in-flight map for the stale-stats sweep so it doesn't
// suppress (or get suppressed by) the score-/live-triggered full refresh above.
const staleLastRun = new Map();   // round -> timestamp
const staleInFlight = new Map();  // round -> Promise
const STALE_THROTTLE_MS = 5 * 60 * 1000;
// A concluded game's stored rows are "final" only if they were written after the
// final siren. AFL games run ~2.5h; a 3h buffer keeps a genuine post-siren
// capture from being mistaken for a frozen mid-game snapshot.
const GAME_LENGTH_MS = 3 * 60 * 60 * 1000;

/**
 * Page-visit safety net (runs on app open, scoped to one round): re-pull FINAL
 * stats for any CONCLUDED game in `round` whose stored rows are missing or were
 * captured before the game ended — i.e. a frozen mid-game snapshot. This is the
 * deterministic backstop the score-/live-triggered refresh lacks: a game that
 * concludes with no subsequent (un-throttled) page load otherwise keeps its
 * half-time numbers forever (Rd16 2026: Logan McDonald stuck on 1 kick instead
 * of his final 2). Merges per game — replaces only the two teams involved — so
 * other games in the round are never disturbed, and never wipes a game on an
 * empty/degraded AFL response.
 */
export async function refreshStaleConcludedStats(round, { token = null, force = false } = {}) {
    if (!force) {
        const last = staleLastRun.get(round);
        if (last && Date.now() - last < STALE_THROTTLE_MS) return { skipped: true, reason: 'throttled' };
    }
    if (staleInFlight.has(round)) return staleInFlight.get(round);

    const p = (async () => {
        try {
            const tok = token || await getAFLToken();
            const headers = { "x-media-mis-token": tok };
            const matchesRes = await fetch(
                `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${round}&pageSize=20`,
                { headers, signal: AbortSignal.timeout(10000) }
            );
            if (!matchesRes.ok) throw new Error(`AFL matches HTTP ${matchesRes.status}`);
            const matches = (await matchesRes.json()).matches || [];

            const { db } = await connectToDatabase();
            const collection = db.collection(`${CURRENT_YEAR}_game_results`);
            await ensureGameResultsIndexes(collection);

            // One DB read for the whole round: earliest stored capture per team.
            const stored = await collection
                .find({ round, year: CURRENT_YEAR }, { projection: { team_name: 1, created_at: 1 } })
                .toArray();
            const earliestByTeam = new Map();
            for (const r of stored) {
                const t = new Date(r.created_at).getTime();
                const cur = earliestByTeam.get(r.team_name);
                if (cur === undefined || t < cur) earliestByTeam.set(r.team_name, t);
            }

            let refreshed = 0;
            for (const match of matches) {
                if (match.status !== 'CONCLUDED' || !match.providerId) continue;
                const home = match.home?.team?.club?.name || match.home?.team?.name || '';
                const away = match.away?.team?.club?.name || match.away?.team?.name || '';
                const gameEnd = match.utcStartTime ? new Date(match.utcStartTime).getTime() + GAME_LENGTH_MS : 0;
                const he = earliestByTeam.get(home);
                const ae = earliestByTeam.get(away);
                const allFinal = he !== undefined && ae !== undefined && gameEnd > 0 && he >= gameEnd && ae >= gameEnd;
                if (allFinal && !force) continue; // already have post-siren stats

                const statsRes = await fetch(
                    `https://api.afl.com.au/cfs/afl/playerStats/match/${match.providerId}`,
                    { headers, signal: AbortSignal.timeout(10000) }
                );
                if (!statsRes.ok) continue;
                const players = mapMatchPlayers(await statsRes.json(), match, round);
                if (players.length === 0) continue; // never wipe on a degraded response
                await collection.deleteMany({ round, year: CURRENT_YEAR, team_name: { $in: [home, away] } });
                await insertManyTolerant(collection, players);
                refreshed++;
                console.log(`[stale-sync] Re-pulled final stats: R${round} ${home} v ${away} (${players.length} players)`);
            }
            staleLastRun.set(round, Date.now());
            return { refreshed };
        } catch (err) {
            console.warn(`[stale-sync] round ${round} failed: ${err.message}`);
            return { error: err.message };
        } finally {
            staleInFlight.delete(round);
        }
    })();

    staleInFlight.set(round, p);
    return p;
}

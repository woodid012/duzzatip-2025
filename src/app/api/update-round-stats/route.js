import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership

// ── AFL API auth (same pattern as lockout-notify) ───────────────────────────
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

// ── AFL API stats fetcher ───────────────────────────────────────────────────
async function fetchAFLRoundStats(round) {
    const token = await getAFLToken();
    const headers = { "x-media-mis-token": token };

    // Fetch matches for the round
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
                    SC: 0, // SuperCoach not available from AFL API
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

// ── DFS Australia stats fetcher (legacy) ────────────────────────────────────
async function fetchDFSAustraliaStats(round) {
    const DFS_STATS_URL = 'https://dfsaustralia.com/wp-admin/admin-ajax.php';
    const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

    console.log('Downloading AFL stats from DFS Australia...');

    const formData = new URLSearchParams();
    formData.append('action', 'afl_player_stats_download_call_mysql');

    const response = await fetch(DFS_STATS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            'Origin': 'https://dfsaustralia.com',
            'Referer': 'https://dfsaustralia.com/afl-stats-download/'
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json();

    let playerData;
    if (Array.isArray(responseData.data)) {
        playerData = responseData.data;
    } else if (responseData.data && typeof responseData.data === 'string') {
        playerData = JSON.parse(responseData.data);
    } else if (Array.isArray(responseData)) {
        playerData = responseData;
    } else {
        throw new Error('Failed to extract player data: unknown format');
    }

    // Filter and map to our schema
    const roundStats = playerData.filter(record => parseInt(record.round, 10) === round);
    if (roundStats.length === 0) {
        throw new Error(`No DFS stats found for round ${round}`);
    }

    return roundStats.map(record => ({
        player_name: record.player || '',
        team_name: record.team || '',
        opp: record.opponent || '',
        round: round,
        year: CURRENT_YEAR,
        match_date: new Date().toISOString().split('T')[0],
        kicks: parseInt(record.kicks, 10) || 0,
        handballs: parseInt(record.handballs, 10) || 0,
        disposals: (parseInt(record.kicks, 10) || 0) + (parseInt(record.handballs, 10) || 0),
        marks: parseInt(record.marks, 10) || 0,
        tackles: parseInt(record.tackles, 10) || 0,
        hitouts: parseInt(record.hitouts, 10) || 0,
        freesFor: parseInt(record.freesFor, 10) || 0,
        freesAgainst: parseInt(record.freesAgainst, 10) || 0,
        goals: parseInt(record.goals, 10) || 0,
        behinds: parseInt(record.behinds, 10) || 0,
        centreBounceAttendances: parseInt(record.cbas, 10) || 0,
        kickIns: parseInt(record.kickins, 10) || 0,
        kickInsPlayon: parseInt(record.kickinsPlayon, 10) || 0,
        timeOnGroundPercentage: parseInt(record.tog, 10) || 0,
        dreamTeamPoints: parseInt(record.fantasyPoints, 10) || 0,
        SC: parseInt(record.superCoachPoints, 10) || 0,
        match_number: 100 + round,
        startingPosition: record.namedPosition || '',
        created_at: new Date(),
    }));
}

// ── Route handler ───────────────────────────────────────────────────────────
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        const forceSource = searchParams.get('source'); // "afl" | "dfs" | null
        const ifStale = searchParams.get('ifStale') === '1';

        if (isNaN(round)) {
            return Response.json({ error: 'Round parameter is required' }, { status: 400 });
        }

        // If ifStale, check freshness before doing any work
        if (ifStale) {
            const { db } = await connectToDatabase();
            const collection = db.collection(`${CURRENT_YEAR}_game_results`);
            const newest = await collection.findOne(
                { round, year: CURRENT_YEAR },
                { sort: { created_at: -1 }, projection: { created_at: 1 } }
            );
            if (newest?.created_at) {
                const ageMs = Date.now() - new Date(newest.created_at).getTime();
                const ageMinutes = Math.round(ageMs / 60000);
                if (ageMinutes < 10) {
                    return Response.json({ skipped: true, reason: 'fresh', ageMinutes });
                }
            }
        }

        console.log(`Updating stats for round ${round} (source: ${forceSource || 'auto'})`);

        let statsData;
        let source;

        if (forceSource === 'dfs') {
            // Force DFS only
            statsData = await fetchDFSAustraliaStats(round);
            source = 'dfs';
        } else if (forceSource === 'afl') {
            // Force AFL only (no fallback)
            statsData = await fetchAFLRoundStats(round);
            source = 'afl';
        } else {
            // Default: try AFL first, fall back to DFS
            try {
                statsData = await fetchAFLRoundStats(round);
                source = 'afl';
                console.log(`AFL API returned ${statsData.length} player stats`);
            } catch (aflError) {
                console.warn(`AFL API failed (${aflError.message}), falling back to DFS Australia`);
                statsData = await fetchDFSAustraliaStats(round);
                source = 'dfs';
            }
        }

        console.log(`[${source}] ${statsData.length} player stats for round ${round}`);

        if (!statsData || statsData.length === 0) {
            return Response.json({
                error: `No stats found for round ${round}`,
                source,
            }, { status: 404 });
        }

        const result = await updateDatabase(statsData, round);

        return Response.json({
            success: true,
            source,
            message: `Updated stats for round ${round} from ${source.toUpperCase()}`,
            stats: {
                roundProcessed: round,
                recordsProcessed: statsData.length,
                recordsInserted: result.insertedCount,
            },
        });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({
            error: 'Failed to update round stats',
            details: error.message,
        }, { status: 500 });
    }
}

// ── Database update (unchanged schema) ──────────────────────────────────────
async function updateDatabase(statsData, round) {
    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_game_results`);

    // Data is already mapped to our schema by both fetchers
    const processedData = statsData.filter(r => r && typeof r === 'object');

    await collection.deleteMany({ round: round, year: CURRENT_YEAR });
    console.log(`Deleted existing data for round ${round}`);

    const result = await collection.insertMany(processedData);
    console.log(`Inserted ${result.insertedCount} records for round ${round}`);

    return { insertedCount: result.insertedCount };
}

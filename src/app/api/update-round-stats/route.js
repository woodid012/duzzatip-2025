import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { fetchAFLRoundStats, updateGameResults } from '@/app/lib/refreshGameResults';

// ── DFS Australia stats fetcher (legacy fallback) ───────────────────────────
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
            statsData = await fetchDFSAustraliaStats(round);
            source = 'dfs';
        } else if (forceSource === 'afl') {
            statsData = await fetchAFLRoundStats(round);
            source = 'afl';
        } else {
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

        const result = await updateGameResults(statsData, round);

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

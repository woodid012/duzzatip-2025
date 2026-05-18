import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { fetchAFLRoundStats, updateGameResults } from '@/app/lib/refreshGameResults';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
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

        console.log(`Updating stats for round ${round} from AFL API`);

        const statsData = await fetchAFLRoundStats(round);
        console.log(`AFL API returned ${statsData.length} player stats for round ${round}`);

        if (!statsData || statsData.length === 0) {
            return Response.json({
                error: `No stats found for round ${round}`,
            }, { status: 404 });
        }

        const result = await updateGameResults(statsData, round);

        return Response.json({
            success: true,
            source: 'afl',
            message: `Updated stats for round ${round} from AFL API`,
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

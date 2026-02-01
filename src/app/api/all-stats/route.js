import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { parseYearParam } from '@/app/lib/apiUtils';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 1;
        const year = parseYearParam(searchParams);

        const { db } = await connectToDatabase();

        const stats = await db.collection(`${year}_game_results`)
            .find({ round: round })
            .toArray();

        return Response.json(stats);

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch round stats' }, { status: 500 });
    }
}
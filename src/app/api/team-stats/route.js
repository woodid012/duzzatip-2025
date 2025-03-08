import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round')) || 0;
        const teamName = searchParams.get('team');

        const { db } = await connectToDatabase();
        
        // If a team name is provided, find all stats for this team's players in this round
        let playerStats = [];
        if (teamName) {
            playerStats = await db.collection(`${CURRENT_YEAR}_game_results`)
                .find({ 
                    team_name: teamName,
                    round: round
                })
                .toArray();
        }

        // Also get a list of teams that have played in this round
        const teamsPlayed = await db.collection(`${CURRENT_YEAR}_game_results`)
            .distinct('team_name', { round: round });

        return Response.json({
            stats: playerStats,
            teamsPlayed: teamsPlayed
        });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch team stats' }, { status: 500 });
    }
}
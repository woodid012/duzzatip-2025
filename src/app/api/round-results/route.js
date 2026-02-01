import { connectToDatabase } from '@/app/lib/mongodb';
import { POSITIONS } from '@/app/lib/scoring_rules';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { parseYearParam } from '@/app/lib/apiUtils';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        const userId = parseInt(searchParams.get('userId'));
        const year = parseYearParam(searchParams);

        if (!round || !userId) {
            return Response.json({ error: 'Round and userId are required' }, { status: 400 });
        }

        const { db } = await connectToDatabase();

        const teamSelection = await db.collection(`${year}_team_selection`)
            .find({
                Round: round,
                User: userId,
                Active: 1
            })
            .toArray();

        const playerStats = await db.collection(`${year}_game_results`)
            .find({ round: round })
            .toArray();

        const positions = teamSelection.map(selection => {
            const playerStat = playerStats.find(stat => 
                stat.player_name === selection.Player_Name
            );

            if (!playerStat) {
                return {
                    position: selection.Position,
                    player: selection.Player_Name,
                    scoring: { total: 0, breakdown: ['Player stats not found'] },
                    stats: {}
                };
            }

            const positionType = selection.Position.toUpperCase().replace(' ', '_');
            const scoring = POSITIONS[positionType]?.calculation(playerStat) || {
                total: 0,
                breakdown: ['Invalid position type']
            };

            return {
                position: selection.Position,
                player: playerStat.player_name,
                team: playerStat.team,
                scoring,
                stats: playerStat
            };
        });

        const total = positions.reduce((sum, pos) => sum + pos.scoring.total, 0);

        // Fetch dead cert score
        let deadCertScore = 0;
        const tippingResults = await db.collection(`${year}_tipping_results`)
            .findOne({ round: round, userId: userId });
        
        if (tippingResults) {
            deadCertScore = tippingResults.deadCertScore || 0;
        }

        return Response.json({ teamScore: total, deadCertScore, total: total + deadCertScore, positions });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to fetch round results' }, { status: 500 });
    }
}
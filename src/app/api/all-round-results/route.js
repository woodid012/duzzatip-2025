import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { POSITIONS } from '@/app/lib/scoring_rules'; // Assuming this is needed for team score calculation

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));

        if (isNaN(round)) {
            return Response.json({ error: 'Round is required and must be a number' }, { status: 400 });
        }

        const { db } = await connectToDatabase();
        const allUsersResults = [];

        for (const userId in USER_NAMES) {
            if (USER_NAMES.hasOwnProperty(userId)) {
                const userName = USER_NAMES[userId];

                // Replicate logic from round-results/route.js for each user
                const teamSelection = await db.collection(`${CURRENT_YEAR}_team_selection`)
                    .find({ 
                        Round: round,
                        User: parseInt(userId),
                        Active: 1 
                    })
                    .toArray();

                const playerStats = await db.collection(`${CURRENT_YEAR}_game_results`)
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

                const teamScore = positions.reduce((sum, pos) => sum + pos.scoring.total, 0);

                // Fetch dead cert score
                let deadCertScore = 0;
                const tippingResults = await db.collection(`${CURRENT_YEAR}_tipping_results`)
                    .findOne({ round: round, userId: parseInt(userId) });
                
                if (tippingResults) {
                    deadCertScore = tippingResults.deadCertScore || 0;
                    console.log(`User ${userId}, Round ${round}: tippingResults`, tippingResults);
                    console.log(`User ${userId}, Round ${round}: deadCertScore`, deadCertScore);
                }

                const totalScore = teamScore + deadCertScore;

                // Calculate wins (assuming tippingResults has a 'correctTips' field or similar)
                // This part needs refinement based on actual tipping results structure
                let wins = 0;
                if (tippingResults && tippingResults.correctTips !== undefined) {
                    wins = tippingResults.correctTips;
                }

                allUsersResults.push({
                    userId: parseInt(userId),
                    userName: userName,
                    teamScore: teamScore,
                    deadCertScore: deadCertScore,
                    totalScore: totalScore,
                    wins: wins,
                    isStar: false, // Will be set after all results are gathered
                    isCrab: false  // Will be set after all results are gathered
                });
            }
        }

        // Determine star and crab
        if (allUsersResults.length > 0) {
            const maxScore = Math.max(...allUsersResults.map(u => u.totalScore));
            const minScore = Math.min(...allUsersResults.map(u => u.totalScore));

            allUsersResults.forEach(user => {
                if (user.totalScore === maxScore) {
                    user.isStar = true;
                }
                if (user.totalScore === minScore) {
                    user.isCrab = true;
                }
            });
        }

        // Store results in a new collection
        const collectionName = `${CURRENT_YEAR}_ladder_results`;
        await db.collection(collectionName).updateOne(
            { round: round },
            { $set: { round: round, results: allUsersResults, timestamp: new Date() } },
            { upsert: true }
        );

        return Response.json({ message: 'Round results aggregated and stored successfully', data: allUsersResults });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ error: 'Failed to aggregate round results' }, { status: 500 });
    }
}

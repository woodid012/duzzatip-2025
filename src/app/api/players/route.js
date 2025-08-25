import { createApiHandler, getCollection, createSuccessResponse } from '../../lib/apiUtils';

export const GET = createApiHandler(async (request, db) => {
    const playersCollection = getCollection(db, 'players');
    
    const players = await playersCollection
        .find({}, {
            projection: {
                player_id: 1,
                player_name: 1,
                team_name: 1,
                _id: 0
            }
        })
        .toArray();
    
    const playersByTeam = players.reduce((acc, player) => {
        if (!acc[player.team_name]) {
            acc[player.team_name] = [];
        }
        acc[player.team_name].push({
            id: player.player_id,
            name: player.player_name,
            teamName: player.team_name
        });
        return acc;
    }, {});

    return createSuccessResponse(playersByTeam);
});
import { createApiHandler, getCollection, getCollectionForYear, parseYearParam, createSuccessResponse, withReadCache } from '../../lib/apiUtils';

export const GET = createApiHandler(async (request, db) => {
    const { searchParams } = new URL(request.url);
    const year = parseYearParam(searchParams);
    const playersCollection = getCollectionForYear(db, 'players', year);
    
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

    // The roster only moves when update-players runs, so a minute in the
    // browser saves every squad/team page a fetch on the way back.
    return withReadCache(createSuccessResponse(playersByTeam), 60);
});
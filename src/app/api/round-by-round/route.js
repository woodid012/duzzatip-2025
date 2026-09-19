// src/app/api/round-by-round/route.js
//
// The season summary in one read. The round-by-round page used to call
// /api/consolidated-round-results once per round — 21 requests, each of which
// pulls the round's stats and scores every team live. Completed rounds are
// already snapshotted into `${year}_simple_round_results` (by the results and
// simple-ladder routes), and that snapshot carries everything the page shows,
// so it's served here from a single query. Rounds without a snapshot (the one
// in progress, or one not yet synced) are left out; the page fills those from
// the live route.
import { createApiHandler, parseYearParam, withReadCache } from '@/app/lib/apiUtils';
import { USER_NAMES } from '@/app/lib/constants';

const REGULAR_SEASON_ROUNDS = 21;

export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const year = parseYearParam(searchParams);

  const docs = await db
    .collection(`${year}_simple_round_results`)
    .find(
      { round: { $gte: 1, $lte: REGULAR_SEASON_ROUNDS } },
      { projection: { round: 1, results: 1, _id: 0 } }
    )
    .toArray();

  // Snapshots store the opponent by name; the page wants their score too.
  const idByName = {};
  for (const [id, name] of Object.entries(USER_NAMES)) idByName[name] = id;

  const rounds = {};
  for (const doc of docs) {
    if (!doc.results) continue;
    const results = {};
    for (const [userId, result] of Object.entries(doc.results)) {
      const opponentId = result.opponent ? idByName[result.opponent] : null;
      const opponent = opponentId ? doc.results[opponentId] : null;
      results[userId] = {
        ...result,
        opponentScore: opponent ? opponent.totalScore || 0 : 0,
      };
    }
    rounds[doc.round] = results;
  }

  return withReadCache(Response.json({ year, rounds }), 60);
});

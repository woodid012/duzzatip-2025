// src/app/lib/ladderTotals.js
//
// Ladder totals: season W/L/D, points for/against, percentage and ladder points.
// The ladder routes and the round-by-round page all compute these; this is the
// one place the arithmetic lives. Pure — no fetch, no Mongo — so it is tested
// directly in __tests__/ladderTotals.test.js.
//
// Callers keep their own output formatting (the ladder route rounds percentage
// to a number, simple-ladder returns a 2dp string, round-by-round leaves it raw).

/** Percentage = PF / PA * 100. With no PA, PF * 100 (or 0 when PF is not positive). Unrounded. */
export function ladderPercentage(pointsFor, pointsAgainst) {
  if (pointsAgainst === 0) return pointsFor > 0 ? pointsFor * 100 : 0;
  return (pointsFor / pointsAgainst) * 100;
}

/**
 * Tally every fixture into one row per user. Unsorted; percentage left raw.
 *
 * rounds: [{ round, fixtures: [{ home, away }], scores: { [userId]: totalScore } }]
 * A missing score counts as 0. A fixture where both scores are 0 is not played.
 * A fixture naming a user outside userNames is ignored.
 * onMatch({ row, userId, score, result, round }) runs for home then away after
 * each played fixture, for callers that track extra per-match stats; extraFields()
 * gives each row its starting values for those stats.
 */
export function tallyLadder(userNames, rounds, onMatch, extraFields) {
  const rows = Object.entries(userNames).map(([userId, userName]) => ({
    userId,
    userName,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    percentage: 0,
    points: 0,
    ...(extraFields ? extraFields() : {}),
  }));
  const byId = new Map(rows.map(row => [row.userId, row]));

  for (const { round, fixtures, scores } of rounds) {
    for (const fixture of fixtures) {
      const homeId = String(fixture.home);
      const awayId = String(fixture.away);
      const homeScore = scores[homeId] || 0;
      const awayScore = scores[awayId] || 0;
      if (homeScore === 0 && awayScore === 0) continue;

      const home = byId.get(homeId);
      const away = byId.get(awayId);
      if (!home || !away) continue;

      const homeResult = homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'D';
      const awayResult = homeResult === 'W' ? 'L' : homeResult === 'L' ? 'W' : 'D';
      applyResult(home, homeScore, awayScore, homeResult);
      applyResult(away, awayScore, homeScore, awayResult);

      if (onMatch) {
        onMatch({ row: home, userId: homeId, score: homeScore, result: homeResult, round });
        onMatch({ row: away, userId: awayId, score: awayScore, result: awayResult, round });
      }
    }
  }

  for (const row of rows) row.percentage = ladderPercentage(row.pointsFor, row.pointsAgainst);
  return rows;
}

function applyResult(row, scoreFor, scoreAgainst, result) {
  row.played++;
  row.pointsFor += scoreFor;
  row.pointsAgainst += scoreAgainst;
  if (result === 'W') { row.wins++; row.points += 4; }
  else if (result === 'L') row.losses++;
  else { row.draws++; row.points += 2; }
}

/** Sort in place: ladder points desc, then percentage desc (number or numeric string). */
export function sortLadder(rows) {
  return rows.sort((a, b) => b.points - a.points || parseFloat(b.percentage) - parseFloat(a.percentage));
}

/**
 * Round-by-round page totals. Unlike the ladder, the result comes from each
 * user's stored matchResult, not from fixtures, and no ladder points are kept.
 *
 * roundResults: [[round, { [userId]: userResult }], ...] in round order.
 * Returns { [userId]: { rounds: { [round]: {...} }, seasonTotals: {...} } }.
 */
export function roundByRoundTotals(roundResults) {
  const allData = {};

  for (const [round, results] of roundResults) {
    Object.entries(results).forEach(([userId, userResult]) => {
      if (!allData[userId]) {
        allData[userId] = {
          rounds: {},
          seasonTotals: {
            playerScore: 0,
            deadCertScore: 0,
            totalScore: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            pointsFor: 0,
            pointsAgainst: 0,
          },
        };
      }

      const pointsFor = userResult.pointsFor || userResult.totalScore || 0;
      const pointsAgainst = userResult.pointsAgainst || userResult.opponentScore || 0;

      allData[userId].rounds[round] = {
        playerScore: userResult.playerScore || 0,
        deadCertScore: userResult.deadCertScore || 0,
        totalScore: userResult.totalScore || 0,
        matchResult: userResult.matchResult,
        opponent: userResult.opponent,
        opponentScore: userResult.opponentScore || 0,
        pointsFor,
        pointsAgainst,
        isHome: userResult.isHome,
        hasStar: userResult.hasStar,
        hasCrab: userResult.hasCrab,
        substitutionsUsed: userResult.substitutionsUsed || [],
      };

      const totals = allData[userId].seasonTotals;
      totals.playerScore += userResult.playerScore || 0;
      totals.deadCertScore += userResult.deadCertScore || 0;
      totals.totalScore += userResult.totalScore || 0;
      totals.pointsFor += pointsFor;
      totals.pointsAgainst += pointsAgainst;

      if (userResult.matchResult === 'W') totals.wins++;
      else if (userResult.matchResult === 'L') totals.losses++;
      else if (userResult.matchResult === 'D') totals.draws++;
    });
  }

  Object.values(allData).forEach(({ seasonTotals: totals }) => {
    totals.percentage = ladderPercentage(totals.pointsFor, totals.pointsAgainst);
    totals.played = totals.wins + totals.losses + totals.draws;
  });

  return allData;
}

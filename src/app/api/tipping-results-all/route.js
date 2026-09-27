import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { parseYearParam, withReadCache } from '@/app/lib/apiUtils';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import { canSeeOthers } from '@/app/lib/submissionStatus';
import { isMatchComplete, scoreTip, totalTips } from '@/app/lib/tipScoring';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const round = searchParams.get('round');
    const collectionYear = parseYearParam(searchParams);

    if (!round) {
      return NextResponse.json({ error: 'Round is required' }, { status: 400 });
    }

    const roundNum = parseInt(round);
    if (isNaN(roundNum)) {
      return NextResponse.json({ error: 'Invalid round' }, { status: 400 });
    }

    const [fixtures, { db }] = await Promise.all([
      getAflFixtures(collectionYear),
      connectToDatabase(),
    ]);

    // Identify completed rounds for year totals
    const completedRoundNums = [
      ...new Set(
        fixtures
          .filter(isMatchComplete)
          .map(f => f.RoundNumber)
      ),
    ];

    // Two DB queries total (was 16+ separate requests). Projection limited to
    // the fields actually consumed below (indexing by User/Round, and
    // MatchNumber/Team/DeadCert inside buildMatches).
    const tipsProjection = { projection: { User: 1, Round: 1, MatchNumber: 1, Team: 1, DeadCert: 1, _id: 0 } };
    const [roundTips, yearTips] = await Promise.all([
      db.collection(`${collectionYear}_tips`)
        .find({ Round: roundNum, Active: 1 }, tipsProjection)
        .toArray(),
      completedRoundNums.length > 0
        ? db.collection(`${collectionYear}_tips`)
            .find({ Round: { $in: completedRoundNums }, Active: 1 }, tipsProjection)
            .toArray()
        : Promise.resolve([]),
    ]);

    // Index round tips by user
    const roundTipsByUser = {};
    for (const tip of roundTips) {
      if (!roundTipsByUser[tip.User]) roundTipsByUser[tip.User] = [];
      roundTipsByUser[tip.User].push(tip);
    }

    // Index year tips by user → round
    const yearTipsByUserRound = {};
    for (const tip of yearTips) {
      if (!yearTipsByUserRound[tip.User]) yearTipsByUserRound[tip.User] = {};
      if (!yearTipsByUserRound[tip.User][tip.Round]) yearTipsByUserRound[tip.User][tip.Round] = [];
      yearTipsByUserRound[tip.User][tip.Round].push(tip);
    }

    // Collect all user IDs seen across both queries
    const allUserIds = [
      ...new Set([
        ...Object.keys(roundTipsByUser).map(Number),
        ...Object.keys(yearTipsByUserRound).map(Number),
      ]),
    ];

    // Round fixtures (ALL — including upcoming games)
    const roundFixtures = fixtures.filter(f => f.RoundNumber.toString() === round);

    // Build per-user results
    const users = {};

    for (const userId of allUserIds) {
      // --- Round results ---
      const userRoundTips = roundTipsByUser[userId] || [];
      const roundMatches = buildMatches(roundFixtures, userRoundTips);
      const roundScores = totalTips(roundMatches);

      // --- Year totals ---
      let yearCorrect = 0;
      let yearDC = 0;
      const userYearTips = yearTipsByUserRound[userId] || {};

      for (const completedRound of completedRoundNums) {
        const completedFixtures = fixtures.filter(
          f => f.RoundNumber === completedRound && isMatchComplete(f)
        );
        const tipsForRound = userYearTips[completedRound] || [];
        const scores = totalTips(buildMatches(completedFixtures, tipsForRound));
        yearCorrect += scores.correctTips;
        yearDC += scores.deadCertScore;
      }

      users[userId] = {
        round: {
          matches: roundMatches,
          correctTips: roundScores.correctTips,
          deadCertScore: roundScores.deadCertScore,
          totalScore: roundScores.correctTips + roundScores.deadCertScore,
        },
        year: {
          correctTips: yearCorrect,
          deadCertScore: yearDC,
        },
      };
    }

    // Privacy: everyone's round tips open up at the first bounce — but only to
    // viewers who got their own tips in before it. A viewer still entering tips
    // under the rolling window sees only their own, otherwise the concession
    // would hand them everyone else's picks to copy. Year totals come from
    // already-completed rounds, so they stay either way. Admin sees all.
    const sess = getSessionUser(request);
    const isAdmin = sess && sess.uid === ADMIN_UID;
    const ownId = sess && sess.uid ? Number(sess.uid) : null;
    const canSee = await canSeeOthers(db, 'tips', roundNum, { isAdmin, viewerId: ownId }, collectionYear);

    if (!canSee) {
      for (const uid of Object.keys(users)) {
        if (Number(uid) === ownId) continue;
        users[uid].round = {
          matches: [],
          correctTips: 0,
          deadCertScore: 0,
          totalScore: 0,
          hidden: true,
        };
      }
      return withReadCache(NextResponse.json({ users, restricted: true }), 15);
    }

    return withReadCache(NextResponse.json({ users }), 15);
  } catch (error) {
    console.error('tipping-results-all error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate results' },
      { status: 500 }
    );
  }
}

function buildMatches(fixtures, tips) {
  return fixtures.map(match => scoreTip(match, tips.find(t => t.MatchNumber === match.MatchNumber)));
}

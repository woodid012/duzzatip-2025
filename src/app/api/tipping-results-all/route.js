import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { parseYearParam } from '@/app/lib/apiUtils';

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
          .filter(f => f.HomeTeamScore !== null && f.AwayTeamScore !== null)
          .map(f => f.RoundNumber)
      ),
    ];

    // Two DB queries total (was 16+ separate requests)
    const [roundTips, yearTips] = await Promise.all([
      db.collection(`${collectionYear}_tips`)
        .find({ Round: roundNum, Active: 1 })
        .toArray(),
      completedRoundNums.length > 0
        ? db.collection(`${collectionYear}_tips`)
            .find({ Round: { $in: completedRoundNums }, Active: 1 })
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
      const roundScores = computeScores(roundMatches.filter(m => m.isCompleted));

      // --- Year totals ---
      let yearCorrect = 0;
      let yearDC = 0;
      const userYearTips = yearTipsByUserRound[userId] || {};

      for (const completedRound of completedRoundNums) {
        const completedFixtures = fixtures.filter(
          f =>
            f.RoundNumber === completedRound &&
            f.HomeTeamScore !== null &&
            f.AwayTeamScore !== null
        );
        const tipsForRound = userYearTips[completedRound] || [];
        const scores = computeScores(buildMatches(completedFixtures, tipsForRound));
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

    return NextResponse.json({ users });
  } catch (error) {
    console.error('tipping-results-all error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to calculate results' },
      { status: 500 }
    );
  }
}

function buildMatches(fixtures, tips) {
  return fixtures.map(match => {
    const tip = tips.find(t => t.MatchNumber === match.MatchNumber);
    const isCompleted = match.HomeTeamScore !== null && match.AwayTeamScore !== null;
    const tipTeam = tip ? tip.Team : match.HomeTeam;
    const isDefault = !tip;
    const isDeadCert = tip ? tip.DeadCert : false;

    let isCorrect = false;
    if (isCompleted) {
      const winner =
        match.HomeTeamScore > match.AwayTeamScore
          ? match.HomeTeam
          : match.AwayTeamScore > match.HomeTeamScore
          ? match.AwayTeam
          : 'Draw';
      isCorrect = tipTeam === winner;
    }

    return {
      matchNumber: match.MatchNumber,
      homeTeam: match.HomeTeam,
      awayTeam: match.AwayTeam,
      homeScore: match.HomeTeamScore,
      awayScore: match.AwayTeamScore,
      tip: tipTeam,
      deadCert: isDeadCert,
      correct: isCompleted ? isCorrect : null,
      isDefault,
      isCompleted,
    };
  });
}

function computeScores(completedMatches) {
  let correctTips = 0;
  let deadCertScore = 0;
  for (const match of completedMatches) {
    if (match.correct) {
      correctTips++;
      if (match.deadCert) deadCertScore += 6;
    } else if (match.deadCert) {
      deadCertScore -= 12;
    }
  }
  return { correctTips, deadCertScore };
}

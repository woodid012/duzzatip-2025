import { createApiHandler, getCollection } from '../../lib/apiUtils';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import path from 'path';
import fs from 'fs/promises';

// Efficiently calculate entire tipping ladder with minimal database queries
export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const upToRound = parseInt(searchParams.get('upToRound')) || 24;
  
  try {
    console.log(`Calculating consolidated tipping ladder up to round ${upToRound}`);

    // First check cache directly from database
    const cachedLadder = await getCollection(db, 'tipping_ladder_cache')
      .findOne({ 
        upToRound: upToRound, 
        year: CURRENT_YEAR 
      });

    if (cachedLadder) {
      console.log(`Using cached tipping ladder up to round ${upToRound}`);
      return Response.json({
        upToRound,
        cached: true,
        ladder: cachedLadder.ladder,
        roundResults: cachedLadder.roundResults || {},
        cachedAt: cachedLadder.cachedAt,
        lastUpdated: cachedLadder.lastUpdated
      });
    }

    // Get AFL fixtures data for match results
    const fixturesPath = path.join(process.cwd(), 'public', `afl-${CURRENT_YEAR}.json`);
    const fixturesData = await fs.readFile(fixturesPath, 'utf8');
    const fixtures = JSON.parse(fixturesData);

    // Get all tips for all users and rounds in one query
    const allTips = await getCollection(db, 'tips')
      .find({
        Round: { $lte: upToRound },
        Active: 1,
        User: { $in: Object.keys(USER_NAMES).map(id => parseInt(id)) }
      })
      .toArray();

    // Group tips by user and round
    const tipsByUserAndRound = {};
    allTips.forEach(tip => {
      const userId = tip.User.toString();
      const round = tip.Round;
      
      if (!tipsByUserAndRound[userId]) {
        tipsByUserAndRound[userId] = {};
      }
      if (!tipsByUserAndRound[userId][round]) {
        tipsByUserAndRound[userId][round] = [];
      }
      
      tipsByUserAndRound[userId][round].push(tip);
    });

    // Calculate ladder data for each user
    const ladderData = [];
    const roundResults = {};

    for (const userId of Object.keys(USER_NAMES)) {
      const userTips = tipsByUserAndRound[userId] || {};
      
      let totalCorrectTips = 0;
      let totalDCCount = 0;
      let correctDCCount = 0;
      let wrongDCCount = 0;
      let netDCScore = 0;
      
      // Process each round
      for (let round = 1; round <= upToRound; round++) {
        const roundTips = userTips[round] || [];
        
        // Get completed matches for this round
        const completedMatches = fixtures.filter(match => 
          match.RoundNumber === round &&
          match.HomeTeamScore !== null &&
          match.AwayTeamScore !== null
        );

        let roundCorrectTips = 0;
        let roundDCScore = 0;
        const roundMatches = [];

        // Process each completed match
        completedMatches.forEach(match => {
          const tip = roundTips.find(t => t.MatchNumber === match.MatchNumber);
          
          // Determine winning team
          const winningTeam = match.HomeTeamScore > match.AwayTeamScore 
            ? match.HomeTeam 
            : match.AwayTeamScore > match.HomeTeamScore 
              ? match.AwayTeam 
              : 'Draw';
          
          // Default to home team if no tip
          const tipTeam = tip ? tip.Team : match.HomeTeam;
          const isDeadCert = tip ? tip.DeadCert : false;
          const isCorrect = tipTeam === winningTeam;
          
          // Update round stats
          if (isCorrect) {
            roundCorrectTips++;
            if (isDeadCert) {
              roundDCScore += 6;
              correctDCCount++;
            }
          } else if (isDeadCert) {
            roundDCScore -= 12;
            wrongDCCount++;
          }
          
          if (isDeadCert) {
            totalDCCount++;
          }
          
          roundMatches.push({
            matchNumber: match.MatchNumber,
            homeTeam: match.HomeTeam,
            awayTeam: match.AwayTeam,
            tip: tipTeam,
            deadCert: isDeadCert,
            correct: isCorrect,
            isDefault: !tip
          });
        });

        // Store round results
        if (!roundResults[round]) {
          roundResults[round] = {};
        }
        roundResults[round][userId] = {
          correctTips: roundCorrectTips,
          deadCertScore: roundDCScore,
          totalScore: roundCorrectTips + roundDCScore,
          completedMatches: roundMatches
        };

        // Update totals
        totalCorrectTips += roundCorrectTips;
        netDCScore += roundDCScore;
      }

      // Calculate DC accuracy
      const dcAccuracy = totalDCCount > 0 ? ((correctDCCount / totalDCCount) * 100).toFixed(1) : '0.0';
      const totalScore = totalCorrectTips + netDCScore;

      ladderData.push({
        userId,
        userName: USER_NAMES[userId],
        correctTips: totalCorrectTips,
        totalDCCount,
        correctDCCount,
        wrongDCCount,
        netDCScore,
        dcAccuracy: parseFloat(dcAccuracy),
        totalScore,
        position: 0 // Will be calculated after sorting
      });
    }

    // Sort by total score (descending) then by DC accuracy (descending)
    ladderData.sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      return b.dcAccuracy - a.dcAccuracy;
    });

    // Assign positions
    ladderData.forEach((user, index) => {
      user.position = index + 1;
    });

    const responseData = {
      upToRound,
      cached: false,
      ladder: ladderData,
      roundResults,
      calculatedAt: new Date().toISOString()
    };

    // Cache the results directly to database
    try {
      const tippingLadderCache = getCollection(db, 'tipping_ladder_cache');
      
      await tippingLadderCache.updateOne(
        { upToRound: upToRound, year: CURRENT_YEAR },
        {
          $set: {
            upToRound,
            year: CURRENT_YEAR,
            ladder: ladderData,
            roundResults: roundResults || {},
            cachedAt: new Date(),
            lastUpdated: new Date()
          }
        },
        { upsert: true }
      );
      
      console.log(`Cached tipping ladder up to round ${upToRound}`);
    } catch (cacheError) {
      console.error(`Error caching tipping ladder:`, cacheError);
      // Don't fail the response if caching fails
    }

    return Response.json(responseData);

  } catch (error) {
    console.error('Consolidated tipping ladder error:', error);
    throw error;
  }
});
import { CURRENT_YEAR } from '@/app/lib/constants';
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import path from 'path';
import fs from 'fs/promises';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const round = searchParams.get('round');
    const userId = searchParams.get('userId');
    const year = searchParams.get('year');

    if (!userId) {
      throw new Error('UserId is required');
    }

    // Read local JSON file with fixtures
    const fixturesPath = path.join(process.cwd(), 'public', `afl-${CURRENT_YEAR}.json`);
    let fixturesData;
    
    try {
      fixturesData = await fs.readFile(fixturesPath, 'utf8');
    } catch (error) {
      console.error('Failed to read fixtures file:', error);
      throw new Error('Failed to read fixtures file');
    }
    
    const fixtures = JSON.parse(fixturesData);
    const { db } = await connectToDatabase();

    // If year parameter is provided, calculate totals for all rounds in the year
    if (year) {
      // Find all rounds that have completed matches
      const completedRounds = findCompletedRounds(fixtures);
      
      // Initialize variables to accumulate totals
      let totalCorrectTips = 0;
      let totalDeadCertScore = 0;
      
      // Process each completed round
      for (const roundNumber of completedRounds) {
        // Get tips for this round
        const tips = await db.collection(`${CURRENT_YEAR}_tips`)
          .find({ 
            Round: parseInt(roundNumber),
            User: parseInt(userId),
            Active: 1 
          }).toArray();
        
        // Get round fixtures
        const roundFixtures = fixtures.filter(match => 
          match.RoundNumber.toString() === roundNumber.toString() &&
          match.HomeTeamScore !== null &&
          match.AwayTeamScore !== null
        );
        
        // Calculate results for this round
        const roundResults = calculateRoundResults(roundFixtures, tips);
        
        // Add to year totals
        totalCorrectTips += roundResults.correctTips;
        totalDeadCertScore += roundResults.deadCertScore;
      }
      
      // Return year totals
      return NextResponse.json({
        userId,
        year,
        correctTips: totalCorrectTips,
        deadCertScore: totalDeadCertScore,
        totalScore: totalCorrectTips + totalDeadCertScore
      });
    }

    // Regular round-specific processing
    if (!round) {
      throw new Error('Round is required when not requesting year totals');
    }

    // Filter completed matches for the round
    const completedMatches = fixtures.filter(match => 
      match.RoundNumber.toString() === round &&
      match.HomeTeamScore !== null &&
      match.AwayTeamScore !== null
    );

    // Return fixtures first
    const fixturesResponse = {
      round,
      matches: completedMatches.map(match => ({
        matchNumber: match.MatchNumber,
        homeTeam: match.HomeTeam,
        awayTeam: match.AwayTeam,
        homeScore: match.HomeTeamScore,
        awayScore: match.AwayTeamScore,
      }))
    };

    // Then get tips from database
    const tips = await db.collection(`${CURRENT_YEAR}_tips`)
      .find({ 
        Round: parseInt(round),
        User: parseInt(userId),
        Active: 1 
      }).toArray();

    // Get all matches for this round (including those without scores yet)
    const allRoundMatches = fixtures.filter(match => 
      match.RoundNumber.toString() === round
    );

    // Process all matches with tips, regardless of completion status
    const allMatchesWithTips = [];
    
    // Go through all matches for this round
    allRoundMatches.forEach(match => {
      // Look for an existing tip
      const tip = tips.find(t => t.MatchNumber === match.MatchNumber);
      
      // Determine if match is completed
      const isCompleted = match.HomeTeamScore !== null && match.AwayTeamScore !== null;
      
      // Initial values
      let isCorrect = false;
      let tipTeam = tip ? tip.Team : match.HomeTeam; // Default to home team
      let isDefault = !tip;
      let isDeadCert = tip ? tip.DeadCert : false;
      
      // Only evaluate correctness if the match is completed
      if (isCompleted) {
        // Get winning team
        const winningTeam = match.HomeTeamScore > match.AwayTeamScore 
          ? match.HomeTeam 
          : match.AwayTeamScore > match.HomeTeamScore 
            ? match.AwayTeam 
            : 'Draw';
            
        // Determine if tip was correct
        isCorrect = tipTeam === winningTeam;
      }
      
      // Add match data with tip
      allMatchesWithTips.push({
        matchNumber: match.MatchNumber,
        homeTeam: match.HomeTeam,
        awayTeam: match.AwayTeam,
        homeScore: match.HomeTeamScore,
        awayScore: match.AwayTeamScore,
        tip: tipTeam,
        deadCert: isDeadCert,
        correct: isCompleted ? isCorrect : null, // Only set if completed
        isDefault: isDefault,
        isCompleted: isCompleted // Add flag to indicate completion status
      });
    });
    
    // Calculate results (only count completed matches for scoring)
    const { correctTips, deadCertScore } = calculateScores(
      allMatchesWithTips.filter(m => m.isCompleted)
    );
    
    return NextResponse.json({
      ...fixturesResponse,
      userId,
      totalMatches: completedMatches.length,
      correctTips,
      deadCertScore,
      totalScore: correctTips + deadCertScore,
      completedMatches: allMatchesWithTips
    });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to calculate results' },
      { status: 500 }
    );
  }
}

// Helper function to find all rounds with completed matches
function findCompletedRounds(fixtures) {
  const completedRounds = new Set();
  
  fixtures.forEach(match => {
    if (match.HomeTeamScore !== null && match.AwayTeamScore !== null) {
      completedRounds.add(match.RoundNumber.toString());
    }
  });
  
  return Array.from(completedRounds).sort((a, b) => parseInt(a) - parseInt(b));
}

// Helper function to calculate round results
function calculateRoundResults(matches, tips) {
  let correctTips = 0;
  let deadCertScore = 0;
  let completedMatchesWithTips = [];

  // Go through all matches
  matches.forEach(match => {
    // Look for an existing tip
    const tip = tips.find(t => t.MatchNumber === match.MatchNumber);
    
    // Only process completed matches
    if (match.HomeTeamScore !== null && match.AwayTeamScore !== null) {
      // Get winning team
      const winningTeam = match.HomeTeamScore > match.AwayTeamScore 
        ? match.HomeTeam 
        : match.AwayTeamScore > match.HomeTeamScore 
          ? match.AwayTeam 
          : 'Draw';
      
      // If tip exists, use it
      let tipTeam = tip ? tip.Team : match.HomeTeam; // Default to home team
      let isDefault = !tip;
      let isDeadCert = tip ? tip.DeadCert : false;
      
      // Determine if tip was correct
      const isCorrect = tipTeam === winningTeam;
      
      // Update scores
      if (isCorrect) {
        correctTips++;
        if (isDeadCert) {
          deadCertScore += 6;
        }
      } else if (isDeadCert) {
        deadCertScore -= 12;
      }
      
      // Add to completed matches
      completedMatchesWithTips.push({
        matchNumber: match.MatchNumber,
        homeTeam: match.HomeTeam,
        awayTeam: match.AwayTeam,
        homeScore: match.HomeTeamScore,
        awayScore: match.AwayTeamScore,
        tip: tipTeam,
        deadCert: isDeadCert,
        correct: isCorrect,
        isDefault: isDefault
      });
    }
  });

  return {
    correctTips,
    deadCertScore,
    completedMatchesWithTips
  };
}

// Helper function to calculate scores from completed matches
function calculateScores(completedMatches) {
  let correctTips = 0;
  let deadCertScore = 0;
  
  completedMatches.forEach(match => {
    if (match.correct) {
      correctTips++;
      if (match.deadCert) {
        deadCertScore += 6;
      }
    } else if (match.deadCert) {
      deadCertScore -= 12;
    }
  });
  
  return { correctTips, deadCertScore };
}
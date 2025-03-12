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

    if (!round && !userId) {
      throw new Error('Round or userId is required');
    }

    // Read local JSON file
    const fixturesPath = path.join(process.cwd(), 'public', `afl-${CURRENT_YEAR}.json`);
    let fixturesData;
    
    try {
      fixturesData = await fs.readFile(fixturesPath, 'utf8');
    } catch (error) {
      console.error('Failed to read fixtures file:', error);
      throw new Error('Failed to read fixtures file');
    }
    
    const fixtures = JSON.parse(fixturesData);

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
    const { db } = await connectToDatabase();
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

    // Calculate results
    let correctTips = 0;
    let deadCertScore = 0;
    let completedMatchesWithTips = [];

    // Go through all matches for this round
    allRoundMatches.forEach(match => {
      // Look for an existing tip
      const tip = tips.find(t => t.MatchNumber === match.MatchNumber);
      
      // Determine if match is completed
      const isCompleted = match.HomeTeamScore !== null && match.AwayTeamScore !== null;
      
      if (isCompleted) {
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

    return NextResponse.json({
      ...fixturesResponse,
      userId,
      totalMatches: completedMatches.length,
      correctTips,
      deadCertScore,
      totalScore: correctTips + deadCertScore,
      completedMatches: completedMatchesWithTips
    });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to calculate results' },
      { status: 500 }
    );
  }
}
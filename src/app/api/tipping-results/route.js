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
    const fixturesData = await fs.readFile(fixturesPath, 'utf8');
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

    // Calculate results
    let correctTips = 0;
    let deadCertScore = 0;

    completedMatches.forEach(match => {
      const tip = tips.find(t => t.MatchNumber === match.MatchNumber);
      if (!tip) return;

      const winningTeam = match.HomeTeamScore > match.AwayTeamScore 
        ? match.HomeTeam 
        : match.AwayTeamScore > match.HomeTeamScore 
          ? match.AwayTeam 
          : 'Draw';

      const isCorrect = tip.Team === winningTeam;

      if (isCorrect) {
        correctTips++;
        if (tip.DeadCert) {
          deadCertScore += 6;
        }
      } else if (tip.DeadCert) {
        deadCertScore -= 12;
      }
    });

    return NextResponse.json({
      ...fixturesResponse,
      userId,
      totalMatches: completedMatches.length,
      correctTips,
      deadCertScore,
      totalScore: correctTips + deadCertScore,
      completedMatches: completedMatches.map(match => ({
        matchNumber: match.MatchNumber,
        homeTeam: match.HomeTeam,
        awayTeam: match.AwayTeam,
        homeScore: match.HomeTeamScore,
        awayScore: match.AwayTeamScore,
        tip: tips.find(t => t.MatchNumber === match.MatchNumber)?.Team || null,
        deadCert: tips.find(t => t.MatchNumber === match.MatchNumber)?.DeadCert || false,
        correct: tips.find(t => t.MatchNumber === match.MatchNumber)?.Team === 
          (match.HomeTeamScore > match.AwayTeamScore ? match.HomeTeam : match.AwayTeam)
      }))
    });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to calculate results' },
      { status: 500 }
    );
  }
}
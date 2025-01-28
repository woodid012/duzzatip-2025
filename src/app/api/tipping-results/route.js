import { CURRENT_YEAR } from '@/app/lib/constants';
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const round = searchParams.get('round');
    const userId = searchParams.get('userId');

    if (!round && !userId) {
      throw new Error('Round or userId is required');
    }

    // Fetch fixtures
    const fixturesResponse = await fetch(`https://fixturedownload.com/feed/json/afl-${CURRENT_YEAR}`);
    if (!fixturesResponse.ok) {
      throw new Error(`Failed to fetch fixtures: ${fixturesResponse.status}`);
    }
    const fixtures = await fixturesResponse.json();

    // Filter completed matches for the round
    const completedMatches = fixtures.filter(match => 
      match.RoundNumber.toString() === round &&
      match.HomeTeamScore !== null &&
      match.AwayTeamScore !== null
    );

    // Get tips from database
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
          deadCertScore += 6; // +6 for correct dead cert
        }
      } else if (tip.DeadCert) {
        deadCertScore -= 12; // -12 for incorrect dead cert
      }
    });

    return NextResponse.json({
      round,
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
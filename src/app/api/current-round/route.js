import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

export async function GET() {
  try {
    const jsonDirectory = path.join(process.cwd(), 'public');
    const fileContents = await fs.readFile(jsonDirectory + '/afl-2025.json', 'utf8');
    const fixtures = JSON.parse(fileContents);

    const now = new Date();
    let currentRound = 1; // Default to round 1

    // Sort fixtures by date to ensure we process them in chronological order
    fixtures.sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));

    // Find the highest round number where all matches have a DateUtc in the past
    const rounds = [...new Set(fixtures.map(match => match.RoundNumber))].sort((a, b) => a - b);

    for (const round of rounds) {
      // Skip round 0 if it exists and is not a valid round
      if (round === 0) continue;

      const matchesInRound = fixtures.filter(match => match.RoundNumber === round);
      const allMatchesPlayed = matchesInRound.every(match => new Date(match.DateUtc) < now);

      if (allMatchesPlayed) {
        currentRound = round;
      } else {
        // If not all matches in this round have been played, then the previous round was the current one.
        // Or if it's the very first round and not all matches are played, it's still round 1.
        break;
      }
    }

    return NextResponse.json({ currentRound });
  } catch (error) {
    console.error('Failed to determine current round:', error);
    return NextResponse.json({ error: 'Failed to determine current round' }, { status: 500 });
  }
}

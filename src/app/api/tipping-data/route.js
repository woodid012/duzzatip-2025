import { CURRENT_YEAR } from '@/app/lib/constants';
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

export async function GET(request) {
  try {
    // Get fixtures from external API
    const response = await fetch(`https://fixturedownload.com/feed/json/afl-${CURRENT_YEAR}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch fixtures: ${response.status}`);
    }
    const fixtures = await response.json();

    // Get round from query params
    const { searchParams } = new URL(request.url);
    const round = searchParams.get('round');
    const userId = searchParams.get('userId');

    // If we have a round and userId, fetch tips from database
    if (round && userId) {
      const { db } = await connectToDatabase();
      const tips = await db.collection(`${CURRENT_YEAR}_tips`)
        .find({ 
          Round: parseInt(round),
          User: parseInt(userId),
          Active: 1 
        }).toArray();

      // Return both fixtures and tips
      return NextResponse.json({
        fixtures,
        tips: tips.reduce((acc, tip) => ({
          ...acc,
          [tip.MatchNumber]: {
            team: tip.Team,
            deadCert: tip.DeadCert
          }
        }), {})
      });
    }

    // If no round/userId, just return fixtures
    return NextResponse.json(fixtures);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { round, userId, tips } = await request.json();
    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_tips`);

    // Create bulk operations array
    const bulkOps = [];

    // First, mark all existing tips for this user and round as inactive
    bulkOps.push({
      updateMany: {
        filter: { 
          User: parseInt(userId),
          Round: parseInt(round)
        },
        update: { $set: { Active: 0 } }
      }
    });

    // Then, insert or update new tips
    Object.entries(tips).forEach(([matchNumber, tipData]) => {
      if (tipData && tipData.team) {
        bulkOps.push({
          updateOne: {
            filter: {
              User: parseInt(userId),
              Round: parseInt(round),
              MatchNumber: parseInt(matchNumber)
            },
            update: {
              $set: {
                Team: tipData.team,
                DeadCert: tipData.deadCert || false,
                Active: 1,
                LastUpdated: new Date()
              }
            },
            upsert: true
          }
        });
      }
    });

    // Execute all operations in a single batch
    if (bulkOps.length > 0) {
      await collection.bulkWrite(bulkOps, { ordered: false });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving tips:', error);
    return NextResponse.json(
      { error: 'Failed to save tips' },
      { status: 500 }
    );
  }
}
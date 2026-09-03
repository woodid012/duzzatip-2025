import { CURRENT_YEAR } from '@/app/lib/constants';
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { parseYearParam, blockWritesForPastYear } from '@/app/lib/apiUtils';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import { startedMatchNumbers } from '@/app/lib/roundAccess';
import { startedMatchNumbers as startedMatchNumbersFor } from '@/app/lib/rollingLockout';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseYearParam(searchParams);

    // Get fixtures (cached in memory, uses local file first, falls back to external API)
    const fixtures = await getAflFixtures(year);

    // Get round from query params
    const round = searchParams.get('round');
    const userId = searchParams.get('userId');

    // If we have a round and userId, fetch tips from database
    if (round && userId) {
      const { db } = await connectToDatabase();
      const tipsCollection = db.collection(`${year}_tips`);
      const tips = await tipsCollection
        .find({
          Round: parseInt(round),
          User: parseInt(userId),
          Active: 1
        }).toArray();

      // Privacy under rolling lockout: the owner (and admin) always see their
      // own tips. Anyone else sees a match's tip only once that match has
      // commenced — a tip that's still editable must stay unseen, or rivals
      // could read it and re-tip the same game.
      const sess = getSessionUser(request);
      const isAdmin = sess && sess.uid === ADMIN_UID;
      const ownId = sess && sess.uid ? Number(sess.uid) : null;
      const canSeeAll = isAdmin || ownId === parseInt(userId);
      const started = canSeeAll ? null : await startedMatchNumbers(parseInt(round), year);
      const visibleTips = canSeeAll
        ? tips
        : tips.filter((t) => started.has(Number(t.MatchNumber)));

      // Get last updated time (only when the viewer may see this user's tips)
      const lastUpdate = canSeeAll
        ? await tipsCollection
            .find({ Round: parseInt(round), User: parseInt(userId), Active: 1 })
            .sort({ LastUpdated: -1 })
            .limit(1)
            .toArray()
        : [];

      const lastUpdated = lastUpdate.length > 0 ? lastUpdate[0].LastUpdated : null;

      // Get fixtures for this round
      const roundFixtures = fixtures.filter(f => f.RoundNumber.toString() === round);
      
      // Build tips object including default Home Team selections for missing tips
      const tipsWithDefaults = {};
      roundFixtures.forEach(fixture => {
        const existingTip = visibleTips.find(t => t.MatchNumber === fixture.MatchNumber);
        
        if (existingTip) {
          tipsWithDefaults[fixture.MatchNumber] = {
            team: existingTip.Team,
            deadCert: existingTip.DeadCert
          };
        } else {
          // Default to home team if no tip exists
          tipsWithDefaults[fixture.MatchNumber] = {
            team: fixture.HomeTeam,
            deadCert: false,
            isDefault: true
          };
        }
      });

      // Build response
      const response = {
        fixtures,
        tips: tipsWithDefaults,
        lastUpdated
      };

      return NextResponse.json(response);
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
    const { round, userId, tips, lastUpdated, year: bodyYear } = await request.json();

    // Block writes for past years
    const blocked = blockWritesForPastYear(bodyYear || CURRENT_YEAR);
    if (blocked) return blocked;

    // Write protection: you may only save your OWN tips (admin may save anyone's).
    const sess = getSessionUser(request);
    const isAdmin = sess && sess.uid === ADMIN_UID;
    if (!isAdmin && (!sess || Number(sess.uid) !== Number(userId))) {
      return NextResponse.json({ error: 'Not authorised to edit these tips' }, { status: 403 });
    }

    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_tips`);
    const roundNum = parseInt(round);
    const userNum = parseInt(userId);

    // Rolling lockout, enforced here rather than trusted from the client: once a
    // match has commenced its tip and dead cert are final, but every match still
    // to come stays editable. Locked matches are dropped from the payload — the
    // stored tip for them is left exactly as it was.
    // blockWritesForPastYear above guarantees this is the current season, which
    // is also the season the collections above are keyed to.
    const fixtures = await getAflFixtures(CURRENT_YEAR);
    const roundMatchNumbers = fixtures
      .filter(f => Number(f.RoundNumber) === roundNum)
      .map(f => Number(f.MatchNumber));
    const locked = isAdmin ? new Set() : startedMatchNumbersFor(fixtures, roundNum);

    const writableTips = Object.entries(tips || {}).filter(
      ([matchNumber, tipData]) => tipData && tipData.team && !locked.has(parseInt(matchNumber))
    );
    const rejected = Object.keys(tips || {})
      .map(Number)
      .filter(m => locked.has(m));

    // Create bulk operations array
    const bulkOps = [];

    // Retire any stored tip for a match that's no longer scheduled in this
    // round. Deliberately NOT a blanket deactivate of the round: that would
    // wipe the locked tips we're intentionally leaving untouched.
    if (roundMatchNumbers.length > 0) {
      bulkOps.push({
        updateMany: {
          filter: {
            User: userNum,
            Round: roundNum,
            MatchNumber: { $nin: roundMatchNumbers }
          },
          update: { $set: { Active: 0 } }
        }
      });
    }

    // Then, insert or update the tips that are still open
    writableTips.forEach(([matchNumber, tipData]) => {
      bulkOps.push({
        updateOne: {
          filter: {
            User: userNum,
            Round: roundNum,
            MatchNumber: parseInt(matchNumber)
          },
          update: {
            $set: {
              Team: tipData.team,
              DeadCert: tipData.deadCert || false,
              Active: 1,
              LastUpdated: lastUpdated ? new Date(lastUpdated) : new Date(),
              IsDefault: tipData.isDefault || false
            }
          },
          upsert: true
        }
      });
    });

    // Execute all operations in a single batch
    if (bulkOps.length > 0) {
      await collection.bulkWrite(bulkOps, { ordered: false });
    }

    if (rejected.length > 0) {
      console.log(
        `Rolling lockout: ignored tips for already-started match(es) ${rejected.join(', ')} ` +
        `(user ${userNum}, round ${roundNum})`
      );
    }

    // Invalidate tipping ladder cache for this round and onwards
    // Tips changing affects ladder calculations from this round forward
    try {
      const tippingLadderCache = db.collection(`${CURRENT_YEAR}_tipping_ladder_cache`);
      
      // Clear cache for rounds >= fromRound (when a specific round's tips change)
      await tippingLadderCache.deleteMany({
        year: CURRENT_YEAR,
        upToRound: { $gte: parseInt(round) }
      });
      
      console.log(`Invalidated tipping ladder cache from round ${round} onwards due to tip changes`);
    } catch (cacheError) {
      console.error('Error invalidating tipping ladder cache:', cacheError);
      // Don't fail the tip save if cache invalidation fails
    }

    return NextResponse.json({
      success: true,
      saved: writableTips.map(([matchNumber]) => parseInt(matchNumber)),
      // Matches whose game had already commenced — their stored tips are final.
      lockedOut: rejected,
    });
  } catch (error) {
    console.error('Error saving tips:', error);
    return NextResponse.json(
      { error: 'Failed to save tips' },
      { status: 500 }
    );
  }
}
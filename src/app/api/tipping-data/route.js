import { CURRENT_YEAR } from '@/app/lib/constants';
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { parseYearParam, blockWritesForPastYear } from '@/app/lib/apiUtils';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import { lockedTipMatchNumbers } from '@/app/lib/rollingLockout';
import { canSeeOthers, didSubmitOnTime } from '@/app/lib/submissionStatus';

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

      // Privacy: you always see your own tips. You see everyone else's from the
      // first bounce — but only if you got your own tips in before it. A viewer
      // still entering tips under the rolling window sees nobody's, or the
      // concession would just be a licence to copy.
      const sess = getSessionUser(request);
      const isAdmin = sess && sess.uid === ADMIN_UID;
      const ownId = sess && sess.uid ? Number(sess.uid) : null;
      const canSeeAll =
        isAdmin ||
        ownId === parseInt(userId) ||
        (await canSeeOthers(db, 'tips', parseInt(round), { isAdmin, viewerId: ownId }, year));
      const visibleTips = canSeeAll ? tips : [];

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
    const { round, userId, tips, year: bodyYear } = await request.json();

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

    // Lockout, enforced here rather than trusted from the client. A player who
    // had tips in before the first bounce is locked to them for the whole round.
    // A player who missed the deadline may still tip matches that haven't
    // started. Either way, locked matches are dropped from the payload and their
    // stored tip is left exactly as it was.
    // blockWritesForPastYear above guarantees this is the current season, which
    // is also the season the collections above are keyed to.
    const fixtures = await getAflFixtures(CURRENT_YEAR);
    const roundMatchNumbers = fixtures
      .filter(f => Number(f.RoundNumber) === roundNum)
      .map(f => Number(f.MatchNumber));
    const submittedOnTime = isAdmin
      ? false
      : await didSubmitOnTime(db, 'tips', roundNum, userNum, CURRENT_YEAR);
    const locked = isAdmin
      ? new Set()
      : lockedTipMatchNumbers(fixtures, roundNum, { submittedOnTime });

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
              // Stamped server-side, never from the request body. This
              // timestamp decides who counts as an on-time submitter, so a
              // backdated one would buy a late entrant the whole field's tips.
              LastUpdated: new Date(),
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
        `Lockout: ignored tips for match(es) ${rejected.join(', ')} ` +
        `(user ${userNum}, round ${roundNum}) — ` +
        (submittedOnTime ? 'tips were submitted before the first bounce' : 'those games have started')
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
      // True when the whole round was refused because tips were in on time.
      firmlyLocked: submittedOnTime && rejected.length > 0,
    });
  } catch (error) {
    console.error('Error saving tips:', error);
    return NextResponse.json(
      { error: 'Failed to save tips' },
      { status: 500 }
    );
  }
}
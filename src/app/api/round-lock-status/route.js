// src/app/api/round-lock-status/route.js
//
// Who is locked in for a round, and who is still entering. This is the feed for
// the "Around the Grounds" panel, and it's what tells the client whether the
// signed-in player gets a firm lock or the rolling window.
//
// It deliberately carries NO picks — only whether each player submitted before
// the first bounce and how full their team is. That's safe to show everyone:
// knowing someone is locked in tells you nothing about who they locked in.

import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES, POSITION_TYPES } from '@/app/lib/constants';
import { parseYearParam } from '@/app/lib/apiUtils';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import {
  firstGameStart,
  isRoundFullyLocked,
  nextLockoutTime,
} from '@/app/lib/rollingLockout';
import { submittedOnTimeIds } from '@/app/lib/submissionStatus';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseYearParam(searchParams);
    const round = parseInt(searchParams.get('round'));

    if (!Number.isFinite(round)) {
      return Response.json({ error: 'Round is required' }, { status: 400 });
    }

    const [fixtures, { db }] = await Promise.all([
      getAflFixtures(year),
      connectToDatabase(),
    ]);

    const firstBounce = firstGameStart(fixtures, round);
    const roundStarted = !!firstBounce && Date.now() >= firstBounce.getTime();

    const [teamSubmitters, tipSubmitters, teamRows] = await Promise.all([
      submittedOnTimeIds(db, 'team', round, year),
      submittedOnTimeIds(db, 'tips', round, year),
      db
        .collection(`${year}_team_selection`)
        .find(
          { Round: round, Active: 1 },
          { projection: { User: 1, Position: 1, Player_Name: 1, Last_Updated: 1 } }
        )
        .toArray(),
    ]);

    // How full each team is, and when it was last touched.
    const filledByUser = {};
    const lastUpdatedByUser = {};
    for (const row of teamRows) {
      const uid = Number(row.User);
      if (row.Player_Name) filledByUser[uid] = (filledByUser[uid] || 0) + 1;
      const t = row.Last_Updated ? new Date(row.Last_Updated).getTime() : 0;
      if (t > (lastUpdatedByUser[uid] || 0)) lastUpdatedByUser[uid] = t;
    }

    const users = {};
    for (const id of Object.keys(USER_NAMES)) {
      const uid = Number(id);
      const submittedTeam = teamSubmitters.has(uid);
      const submittedTips = tipSubmitters.has(uid);
      const filled = filledByUser[uid] || 0;

      // open    — the round hasn't started, everything is still editable
      // locked  — submitted before the bounce, so committed for the round
      // rolling — missed the deadline, still entering games yet to start
      const lockState = !roundStarted ? 'open' : submittedTeam ? 'locked' : 'rolling';

      users[id] = {
        userId: uid,
        name: USER_NAMES[id],
        submittedTeam,
        submittedTips,
        lockState,
        positionsFilled: filled,
        positionsTotal: POSITION_TYPES.length,
        lastUpdated: lastUpdatedByUser[uid] ? new Date(lastUpdatedByUser[uid]).toISOString() : null,
      };
    }

    const sess = getSessionUser(request);
    const isAdmin = sess && sess.uid === ADMIN_UID;
    const viewerId = sess && sess.uid ? Number(sess.uid) : null;

    return Response.json({
      round,
      year,
      roundStarted,
      allGamesStarted: isRoundFullyLocked(fixtures, round),
      firstBounce: firstBounce ? firstBounce.toISOString() : null,
      nextLockout: nextLockoutTime(fixtures, round)?.toISOString() ?? null,
      viewer: {
        userId: viewerId,
        isAdmin: !!isAdmin,
        // Drives the client's lock rendering: a submitter is firmly locked once
        // the round starts, a non-submitter gets the rolling window.
        submittedTeam: viewerId !== null && teamSubmitters.has(viewerId),
        submittedTips: viewerId !== null && tipSubmitters.has(viewerId),
      },
      users,
    });
  } catch (error) {
    console.error('round-lock-status error:', error);
    return Response.json({ error: 'Failed to load lock status' }, { status: 500 });
  }
}

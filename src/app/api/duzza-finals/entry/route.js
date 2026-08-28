import { createApiHandler, parseYearParam, blockWritesForPastYear, createSuccessResponse } from '@/app/lib/apiUtils';
import { connectToFinalsDatabase } from '@/app/lib/mongodb';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import { isRoundLocked } from '@/app/lib/roundAccess';
import { getAflFixtures } from '@/app/lib/fixtureCache';
import { POSITION_TYPES, BACKUP_POSITIONS, USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';
import {
  DUZZA_FINALS_ROUNDS,
  DUZZA_FINALS_WEEK_LABELS,
  isDuzzaFinalsRound,
  getPlayerPoolForRound,
  computeBracket,
  seedEntrants,
} from '@/app/lib/duzzaFinals';

// seedEntrants is idempotent + cheap, but a per-instance guard avoids paying
// the upsert bulkWrite on every single request within the same lambda's life.
const seededYears = new Set();
async function ensureSeeded(finalsDb, year) {
  if (seededYears.has(year)) return;
  await seedEntrants(finalsDb, year);
  seededYears.add(year);
}

function invalidRoundResponse() {
  return Response.json(
    { error: `Round must be one of: ${DUZZA_FINALS_ROUNDS.join(', ')}` },
    { status: 400 }
  );
}

// GET ?round&year — the single read surface for duzza_finals.${year}_entries.
// Pre-lockout, a logged-in non-admin sees only their own entry; post-lockout
// or admin sees everyone. Mirrors team-selection/tipping-data privacy rules.
export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const year = parseYearParam(searchParams);
  const roundParam = searchParams.get('round');

  if (roundParam === null || roundParam === undefined) {
    return Response.json({ error: 'Round parameter is required' }, { status: 400 });
  }
  const round = parseInt(roundParam, 10);
  if (isNaN(round) || !isDuzzaFinalsRound(round)) {
    return invalidRoundResponse();
  }

  const finalsDb = await connectToFinalsDatabase();
  await ensureSeeded(finalsDb, year);

  const locked = await isRoundLocked(round, year);
  const sess = getSessionUser(request);
  const isAdmin = sess && sess.uid === ADMIN_UID;

  const filter = { Round: round };
  if (!isAdmin && !locked) {
    const ownId = sess && sess.uid != null ? Number(sess.uid) : null;
    if (ownId === null) {
      // Not logged in, pre-lockout: nothing to show.
      return createSuccessResponse({ round, year, locked, entries: {} });
    }
    filter.Entrant = ownId;
  }

  const docs = await finalsDb.collection(`${year}_entries`).find(filter).toArray();

  const entries = {};
  for (const doc of docs) {
    entries[String(doc.Entrant)] = {
      Team: doc.Team || null,
      Tips: doc.Tips || null,
      Name: doc.Name,
      LastUpdated: doc.LastUpdated || null,
    };
  }

  return createSuccessResponse({ round, year, locked, entries });
});

// POST body {round, userId, team?, tips?, year?} — upserts $set on just the
// provided field(s) for {Entrant, Round} in ${year}_entries.
export const POST = createApiHandler(async (request, db) => {
  const body = await request.json();
  const { round: roundParam, userId, team, tips, year: bodyYear } = body || {};

  const year = bodyYear || CURRENT_YEAR;
  const blocked = blockWritesForPastYear(year);
  if (blocked) return blocked;

  if (roundParam === undefined || roundParam === null) {
    return Response.json({ error: 'Round is required' }, { status: 400 });
  }
  const round = parseInt(roundParam, 10);
  if (isNaN(round) || !isDuzzaFinalsRound(round)) {
    return invalidRoundResponse();
  }

  if (userId === undefined || userId === null) {
    return Response.json({ error: 'userId is required' }, { status: 400 });
  }

  const sess = getSessionUser(request);
  const isAdmin = sess && sess.uid === ADMIN_UID;
  if (!sess) {
    return Response.json({ error: 'Not authorised' }, { status: 401 });
  }
  if (!isAdmin && Number(sess.uid) !== Number(userId)) {
    return Response.json({ error: 'Not authorised to edit this entry' }, { status: 403 });
  }

  if (team === undefined && tips === undefined) {
    return Response.json({ error: 'Nothing to save — provide team and/or tips' }, { status: 400 });
  }

  const finalsDb = await connectToFinalsDatabase();
  await ensureSeeded(finalsDb, year);

  // Fixtures-not-published check fires BEFORE the lockout check: isRoundLocked
  // fails safe to "locked" when a round has no fixtures yet, but the 409 here
  // is the clearer signal for this specific case.
  const pool = await getPlayerPoolForRound(db, round, year);
  if (!pool.fixturesKnown) {
    return Response.json(
      { error: `Fixtures for round ${round} have not been published yet` },
      { status: 409 }
    );
  }

  const locked = await isRoundLocked(round, year);
  if (locked && !isAdmin) {
    return Response.json({ error: 'This round is locked' }, { status: 403 });
  }

  // Validate the submitted team against the round's playable pool.
  let validatedTeam;
  if (team !== undefined) {
    const badPositions = [];
    for (const [position, data] of Object.entries(team || {})) {
      if (!POSITION_TYPES.includes(position)) {
        badPositions.push(position);
        continue;
      }
      if (!data || !data.player || !data.club) {
        badPositions.push(position);
        continue;
      }
      const clubPlayers = pool.playersByTeam[data.club];
      const playerExists = clubPlayers && clubPlayers.some((p) => p.name === data.player);
      if (!playerExists) {
        badPositions.push(position);
        continue;
      }
      if (position === 'Bench' && !BACKUP_POSITIONS.includes(data.backup_position)) {
        badPositions.push(position);
      }
    }
    if (badPositions.length > 0) {
      return Response.json(
        { error: `Invalid team selection for position(s): ${badPositions.join(', ')}` },
        { status: 400 }
      );
    }
    validatedTeam = team;
  }

  // Validate submitted tips against the round's real fixtures.
  let validatedTips;
  if (tips !== undefined) {
    const aflFixtures = await getAflFixtures(year);
    const roundFixtures = aflFixtures.filter((f) => Number(f.RoundNumber) === round);
    const byMatchNumber = new Map(roundFixtures.map((f) => [Number(f.MatchNumber), f]));

    const badMatches = [];
    const built = [];
    for (const tip of tips || []) {
      const fixture = byMatchNumber.get(Number(tip.MatchNumber));
      if (!fixture || (tip.Tip !== fixture.HomeTeam && tip.Tip !== fixture.AwayTeam)) {
        badMatches.push(tip.MatchNumber);
        continue;
      }
      built.push({
        MatchNumber: Number(tip.MatchNumber),
        Match: `${fixture.HomeTeam} v ${fixture.AwayTeam}`,
        Tip: tip.Tip,
        DeadCert: Boolean(tip.DeadCert),
      });
    }
    if (badMatches.length > 0) {
      return Response.json(
        { error: `Invalid tip(s) for match number(s): ${badMatches.join(', ')}` },
        { status: 400 }
      );
    }
    validatedTips = built;
  }

  // An entrant already eliminated before this round may not submit for it.
  // Uses computeBracket's finalized eliminations only — a round that hasn't
  // finalized yet (aliveAtStart: null) can't be checked, so it's allowed
  // through rather than blocking on an unknown state.
  const bracket = await computeBracket(db, finalsDb, year);
  const week = bracket.weeks.find((w) => w.round === round);
  if (week && week.aliveAtStart && !week.aliveAtStart.includes(Number(userId))) {
    return Response.json(
      { error: 'This entrant was eliminated before this round and cannot submit picks' },
      { status: 403 }
    );
  }

  const entrant = await finalsDb.collection(`${year}_entrants`).findOne({ EntrantId: Number(userId) });
  const entrantName = entrant?.Name || USER_NAMES[userId] || `User ${userId}`;

  const setFields = {
    Entrant: Number(userId),
    Round: round,
    Week: DUZZA_FINALS_WEEK_LABELS[round],
    Name: entrantName,
    LastUpdated: new Date(),
  };
  if (validatedTeam !== undefined) setFields.Team = validatedTeam;
  if (validatedTips !== undefined) setFields.Tips = validatedTips;

  await finalsDb.collection(`${year}_entries`).updateOne(
    { Entrant: Number(userId), Round: round },
    { $set: setFields },
    { upsert: true }
  );

  return createSuccessResponse({ success: true });
});

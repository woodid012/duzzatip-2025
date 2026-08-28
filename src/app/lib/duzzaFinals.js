// src/app/lib/duzzaFinals.js
// Duzza Finals — ring-fenced weekly knockout side comp over AFL finals rounds
// 26-29. All writes go to the separate `duzza_finals` Mongo database
// (see connectToFinalsDatabase in mongodb.js); reads of season data
// (players/fixtures/game_results) are fine since only writes are ring-fenced.
import { USER_NAMES, TEAM_LOGOS } from './constants';
import { calculateTeamScores } from './scoreCalculations';
import { getAflFixtures, isRoundComplete } from './fixtureCache';

// ── Constants ────────────────────────────────────────────────────────────

export const DUZZA_FINALS_START_ROUND = 26;
export const DUZZA_FINALS_ROUNDS = [26, 27, 28, 29];
export const DUZZA_FINALS_CUT_COUNTS = { 26: 2, 27: 2, 28: 2, 29: 1 };
export const DUZZA_FINALS_WEEK_LABELS = {
  26: 'Qualifying & Elimination Finals',
  27: 'Semi Finals',
  28: 'Preliminary Finals',
  29: 'Grand Final',
};

export function isDuzzaFinalsRound(round) {
  return DUZZA_FINALS_ROUNDS.includes(Number(round));
}

// Ring-fenced, deliberate VERBATIM copy of the map at the top of
// consolidated-round-results/route.js:16-35 — copied, not imported, so the
// main comp's route file can change independently without touching this comp.
export const DUZZA_FINALS_ABBREV_TO_FULL = {
  ADE: 'Adelaide Crows', ADEL: 'Adelaide Crows',
  BRL: 'Brisbane Lions', BL: 'Brisbane Lions',
  CAR: 'Carlton', CARL: 'Carlton',
  COL: 'Collingwood', COLL: 'Collingwood',
  ESS: 'Essendon',
  FRE: 'Fremantle',
  GEE: 'Geelong Cats', GEEL: 'Geelong Cats',
  GCS: 'Gold Coast SUNS', GCFC: 'Gold Coast SUNS',
  GWS: 'GWS GIANTS',
  HAW: 'Hawthorn',
  MEL: 'Melbourne', MELB: 'Melbourne',
  NTH: 'North Melbourne', NMFC: 'North Melbourne',
  PTA: 'Port Adelaide', PORT: 'Port Adelaide',
  RIC: 'Richmond', RICH: 'Richmond',
  STK: 'St Kilda',
  SYD: 'Sydney Swans',
  WCE: 'West Coast Eagles',
  WBD: 'Western Bulldogs', WB: 'Western Bulldogs',
};

// ── Pure helpers (no DB/no fetch) ───────────────────────────────────────

// Filters the full player pool + AFL fixtures down to only the clubs actually
// playing in `round`. fixturesKnown is false only when the round has no
// fixtures published at all (finals rounds start as placeholders in the
// fixture file until earlier rounds resolve). A fixture whose team name
// doesn't map to any real club (finals placeholders like "Winner of QF1")
// is never counted as a team playing.
export function derivePlayerPool(playersByTeam, aflFixtures, round) {
  const roundFixtures = (aflFixtures || []).filter(
    (f) => Number(f.RoundNumber) === Number(round)
  );

  if (roundFixtures.length === 0) {
    return { fixturesKnown: false, teamsPlaying: [], playersByTeam: {} };
  }

  const realClubNames = new Set(Object.values(DUZZA_FINALS_ABBREV_TO_FULL));
  const teamsPlayingSet = new Set();
  for (const f of roundFixtures) {
    if (realClubNames.has(f.HomeTeam)) teamsPlayingSet.add(f.HomeTeam);
    if (realClubNames.has(f.AwayTeam)) teamsPlayingSet.add(f.AwayTeam);
  }

  const filteredPlayersByTeam = {};
  for (const [abbrev, players] of Object.entries(playersByTeam || {})) {
    const full = DUZZA_FINALS_ABBREV_TO_FULL[abbrev];
    if (full && teamsPlayingSet.has(full)) {
      filteredPlayersByTeam[abbrev] = players;
    }
  }

  return {
    fixturesKnown: true,
    teamsPlaying: [...teamsPlayingSet],
    playersByTeam: filteredPlayersByTeam,
  };
}

// Applies a week's cut. Groups scores by exact totalScore and walks the
// groups lowest-first, eliminating a WHOLE group only while doing so keeps
// the cumulative eliminated count <= cutCount. A group that would overshoot
// the cut line survives entirely (never split a tied group) — tieAtCutLine
// flags that this happened. Pure ⇒ idempotent replay from stored entries.
export function computeWeekOutcome(scores, cutCount) {
  const buckets = new Map();
  for (const s of scores) {
    const key = s.totalScore;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s.userId);
  }

  const groups = [...buckets.entries()]
    .map(([totalScore, userIds]) => ({ totalScore: Number(totalScore), userIds }))
    .sort((a, b) => a.totalScore - b.totalScore);

  const eliminated = [];
  let cumulative = 0;
  let tieAtCutLine = false;

  for (const group of groups) {
    if (cumulative + group.userIds.length <= cutCount) {
      eliminated.push(...group.userIds);
      cumulative += group.userIds.length;
    } else {
      // This group would overshoot the cut. A group of size 1 landing here
      // is just the cut line falling cleanly between two distinct scores —
      // only a group of size > 1 sitting on the boundary is a genuine tie
      // that gets spared whole.
      if (group.userIds.length > 1 && cumulative < cutCount) {
        tieAtCutLine = true;
      }
      break;
    }
  }

  const eliminatedSet = new Set(eliminated);
  const survivors = scores
    .filter((s) => !eliminatedSet.has(s.userId))
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((s) => s.userId);

  return { eliminated, survivors, cutApplied: eliminated.length > 0, tieAtCutLine };
}

// Dead-cert scoring for COMPLETED matches only: same rule as the main comp
// (consolidated-round-results/route.js calculateScores) — correct tip scores
// 0 by itself (correctTips tracked for display only), +6 for a correct dead
// cert, -12 for a wrong one.
export function computeDeadCertFromMatches(matchesWithTips) {
  let correctTips = 0;
  let deadCertScore = 0;

  for (const m of matchesWithTips) {
    if (m.correct) {
      correctTips++;
      if (m.deadCert) deadCertScore += 6;
    } else if (m.deadCert) {
      deadCertScore -= 12;
    }
  }

  return { correctTips, deadCertScore };
}

// Splits an entrants list (from `${year}_entrants`) into knockout-eligible
// core ids vs open-registration invited ids. Anything not explicitly
// Source:'invited' is treated as core — invited is the opt-in category, core
// (and admin, which never appears in this collection) is the default.
export function splitEntrantsBySource(entrants) {
  const coreIds = [];
  const invitedIds = [];
  for (const e of entrants || []) {
    const id = Number(e.EntrantId);
    if (e.Source === 'invited') {
      invitedIds.push(id);
    } else {
      coreIds.push(id);
    }
  }
  return { coreIds, invitedIds, allIds: [...coreIds, ...invitedIds] };
}

// Folds one week's scores into the running cumulativeLadder map (keyed by
// entrant id), mutating each matching entry's weeklyTotals/grandTotal in
// place. Pure aside from that mutation — no DB/no fetch — so it can replay
// deterministically over any ladder + scores pair.
export function applyWeekToLadder(cumulativeLadder, weekScores, round) {
  for (const s of weekScores || []) {
    const entry = cumulativeLadder[s.userId];
    if (!entry) continue;
    entry.weeklyTotals[round] = s.totalScore;
    entry.grandTotal += s.totalScore;
  }
}

// Annotates a team's submitted Tips against the round's real fixtures (ALL
// fixtures, not just completed ones — unlike computeDeadCertFromMatches this
// is for display, so an unresolved match's tip is reported 'pending' rather
// than omitted). Same "Draw never counts as correct" convention as elsewhere.
export function annotateTips(tips, roundFixtures) {
  const byMatchNumber = new Map((roundFixtures || []).map((f) => [Number(f.MatchNumber), f]));

  return (tips || []).map((tip) => {
    const fixture = byMatchNumber.get(Number(tip.MatchNumber));
    const match = tip.Match || (fixture ? `${fixture.HomeTeam} v ${fixture.AwayTeam}` : null);
    const deadCert = Boolean(tip.DeadCert);

    const scoresKnown =
      fixture && fixture.HomeTeamScore !== null && fixture.HomeTeamScore !== undefined &&
      fixture.AwayTeamScore !== null && fixture.AwayTeamScore !== undefined;

    if (!scoresKnown) {
      return { matchNumber: Number(tip.MatchNumber), match, tip: tip.Tip, deadCert, correct: 'pending' };
    }

    const winningTeam =
      fixture.HomeTeamScore > fixture.AwayTeamScore
        ? fixture.HomeTeam
        : fixture.AwayTeamScore > fixture.HomeTeamScore
        ? fixture.AwayTeam
        : 'Draw';

    return { matchNumber: Number(tip.MatchNumber), match, tip: tip.Tip, deadCert, correct: tip.Tip === winningTeam };
  });
}

// ── DB wrappers (accept db handles so they stay testable) ──────────────

// Idempotent upsert of the core 8 entrants from USER_NAMES/TEAM_LOGOS. Safe
// to call on every request — an unchanged upsert is a cheap no-op write.
export async function seedEntrants(finalsDb, year) {
  const collection = finalsDb.collection(`${year}_entrants`);
  const bulkOps = Object.keys(USER_NAMES).map((uid) => ({
    updateOne: {
      filter: { EntrantId: Number(uid), Source: 'core' },
      update: {
        $set: {
          EntrantId: Number(uid),
          Name: USER_NAMES[uid],
          Logo: TEAM_LOGOS[uid],
          Source: 'core',
          UserId: Number(uid),
        },
      },
      upsert: true,
    },
  }));

  if (bulkOps.length > 0) {
    await collection.bulkWrite(bulkOps, { ordered: false });
  }
}

// Reads `${year}_players` (the season DB's authoritative roster) and joins it
// with getAflFixtures(year) to derive the round's playable pool.
export async function getPlayerPoolForRound(seasonDb, round, year) {
  const players = await seasonDb
    .collection(`${year}_players`)
    .find({}, { projection: { player_id: 1, player_name: 1, team_name: 1, _id: 0 } })
    .toArray();

  const playersByTeam = players.reduce((acc, p) => {
    if (!acc[p.team_name]) acc[p.team_name] = [];
    acc[p.team_name].push({ id: p.player_id, name: p.player_name, teamName: p.team_name });
    return acc;
  }, {});

  const aflFixtures = await getAflFixtures(year);
  return derivePlayerPool(playersByTeam, aflFixtures, round);
}

// Computes weekly scores for `entrantIds` from their stored entry docs. Uses
// the exported (simpler) calculateTeamScores from scoreCalculations.js rather
// than the un-exported live substitution engine used by the main comp results
// route — bench/reserve substitution behaviour is slightly simpler here
// (whole-round roundEndPassed flag rather than per-game live/finished
// tracking), which is an acceptable trade-off for this side comp.
// `options.detail` (default false) additionally returns, per entrant, the
// position-by-position breakdown (positionScores) and tips annotated with
// correctness — everything a "your team" + "around the grounds" results view
// needs, without a second DB round-trip.
export async function computeWeeklyScores(seasonDb, finalsDb, round, year, entrantIds, options = {}) {
  const { detail = false } = options;

  const entries = await finalsDb.collection(`${year}_entries`).find({ Round: Number(round) }).toArray();
  const entryByEntrant = new Map(entries.map((e) => [Number(e.Entrant), e]));

  const gameResults = await seasonDb.collection(`${year}_game_results`).find({ round: Number(round) }).toArray();
  const statsMap = {};
  for (const stat of gameResults) {
    if (stat.player_name) statsMap[stat.player_name] = stat;
  }

  const aflFixtures = await getAflFixtures(year);
  const roundFixtures = aflFixtures.filter((f) => Number(f.RoundNumber) === Number(round));
  const completedFixtures = roundFixtures.filter(
    (f) => f.HomeTeamScore !== null && f.AwayTeamScore !== null
  );

  const roundEndPassed = await isRoundComplete(round, year).catch(() => false);

  return entrantIds.map((entrantId) => {
    const entry = entryByEntrant.get(Number(entrantId));
    if (!entry) {
      const base = { userId: entrantId, playerScore: 0, deadCertScore: 0, totalScore: 0, correctTips: 0 };
      return detail ? { ...base, positionScores: [], tips: [] } : base;
    }

    const team = entry.Team || {};
    const selectedPlayers = Object.entries(team)
      .map(([position, data]) => ({
        position,
        playerName: data?.player,
        backupPosition: data?.backup_position,
      }))
      .filter((p) => p.playerName);

    // Dead cert score from the entry's Tips array against completed fixtures
    // only. Same "Draw never counts as correct" convention as
    // consolidated-round-results/route.js's calculateDeadCertScore: a drawn
    // match's winningTeam is the literal string 'Draw', which no tip can equal.
    const tips = entry.Tips || [];
    const matchesWithTips = completedFixtures.map((f) => {
      const tip = tips.find((t) => Number(t.MatchNumber) === Number(f.MatchNumber));
      const winningTeam =
        f.HomeTeamScore > f.AwayTeamScore
          ? f.HomeTeam
          : f.AwayTeamScore > f.HomeTeamScore
          ? f.AwayTeam
          : 'Draw';
      const correct = Boolean(tip && tip.Tip === winningTeam);
      return { correct, deadCert: Boolean(tip && tip.DeadCert) };
    });
    const { correctTips, deadCertScore } = computeDeadCertFromMatches(matchesWithTips);

    const teamScoreData = calculateTeamScores(
      entrantId,
      { selectedPlayers },
      statsMap,
      deadCertScore,
      roundEndPassed
    );

    const base = {
      userId: entrantId,
      playerScore: teamScoreData.totalScore,
      deadCertScore,
      totalScore: teamScoreData.finalScore,
      correctTips,
    };

    if (!detail) return base;

    const positionScores = (teamScoreData.positionScores || []).map((p) => ({
      position: p.position,
      playerName: p.playerName,
      score: p.score,
      isBenchPlayer: Boolean(p.isBenchPlayer),
      replacementType: p.replacementType || null,
    }));

    return { ...base, positionScores, tips: annotateTips(tips, roundFixtures) };
  });
}

// Replays rounds 26 -> 29, finalizing a round's eliminations only once
// isRoundComplete() is true for it. Before that, scores shown are live/
// partial and eliminated/survivors are null. Once a round fails to finalize,
// every later round's KNOCKOUT goes dark (aliveAtStart: null, scores: [])
// since we don't yet know who's still alive to score for it.
//
// The KNOCKOUT (aliveAtStart/cuts/eliminated/survivors/champion) runs over
// CORE entrants only — open-registration invited entrants never take part in
// the cuts. The cumulativeLadder, by contrast, covers ALL entrants (core +
// invited) and is independent of the knockout's bracketBroken latch: an
// invited entrant's weekly score still accrues in a round where fixtures are
// known even if the core knockout has already broken. Each round computes
// scores once for every entrant (ladderScores) and derives the knockout's
// core-alive `scores` as a filtered subset of that same result, rather than
// querying twice over overlapping id sets.
export async function computeBracket(seasonDb, finalsDb, year) {
  await seedEntrants(finalsDb, year);

  const entrants = await finalsDb.collection(`${year}_entrants`).find({}).toArray();
  const { coreIds, allIds } = splitEntrantsBySource(entrants);
  const nameById = {};
  const sourceById = {};
  for (const e of entrants) {
    const id = Number(e.EntrantId);
    nameById[id] = e.Name;
    sourceById[id] = e.Source === 'invited' ? 'invited' : 'core';
  }

  const cumulativeLadder = {};
  for (const id of allIds) {
    cumulativeLadder[id] = {
      userId: id,
      name: nameById[id],
      source: sourceById[id],
      weeklyTotals: {},
      grandTotal: 0,
    };
  }

  let aliveAtStart = coreIds.slice();
  let bracketBroken = false; // latches true once a round fails to finalize the knockout
  const weeks = [];
  let currentWeek = null;
  let champion = null;
  let coChampions = null;

  for (const round of DUZZA_FINALS_ROUNDS) {
    const cutCount = DUZZA_FINALS_CUT_COUNTS[round];
    const label = DUZZA_FINALS_WEEK_LABELS[round];
    const roundAliveAtStart = bracketBroken ? null : aliveAtStart;

    const pool = await getPlayerPoolForRound(seasonDb, round, year);
    const fixturesKnown = pool.fixturesKnown;
    const roundComplete = fixturesKnown ? await isRoundComplete(round, year).catch(() => false) : false;

    // Ladder scoring runs for ALL entrants whenever fixtures are known, fully
    // independent of bracketBroken — a core knockout broken at round 26 must
    // not stop round 27's ladder scores (core or invited) from accruing.
    let ladderScores = [];
    let scores = [];
    if (fixturesKnown) {
      ladderScores = await computeWeeklyScores(seasonDb, finalsDb, round, year, allIds);
      applyWeekToLadder(cumulativeLadder, ladderScores, round);

      // Knockout `scores` (kept for UI compatibility) is just the core-alive
      // subset of the very same computation — no second query.
      if (!bracketBroken && roundAliveAtStart.length > 0) {
        const aliveSet = new Set(roundAliveAtStart);
        scores = ladderScores.filter((s) => aliveSet.has(Number(s.userId)));
      }
    }

    if (currentWeek === null && !roundComplete) {
      currentWeek = round;
    }

    let eliminated = null;
    let survivors = null;
    let tieAtCutLine = false;

    if (!bracketBroken && fixturesKnown && roundComplete) {
      const outcome = computeWeekOutcome(
        scores.map((s) => ({ userId: s.userId, totalScore: s.totalScore })),
        cutCount
      );
      eliminated = outcome.eliminated;
      survivors = outcome.survivors;
      tieAtCutLine = outcome.tieAtCutLine;

      if (round === DUZZA_FINALS_ROUNDS[DUZZA_FINALS_ROUNDS.length - 1]) {
        if (survivors.length === 1) {
          champion = survivors[0];
        } else if (survivors.length > 1) {
          coChampions = survivors;
        }
      }
    }

    weeks.push({
      round,
      label,
      fixturesKnown,
      roundComplete,
      aliveAtStart: roundAliveAtStart,
      scores,
      ladderScores,
      cutCount,
      eliminated,
      survivors,
      tieAtCutLine,
    });

    if (!bracketBroken && fixturesKnown && roundComplete) {
      aliveAtStart = survivors;
    } else {
      bracketBroken = true;
    }
  }

  if (currentWeek === null) currentWeek = DUZZA_FINALS_ROUNDS[DUZZA_FINALS_ROUNDS.length - 1];

  // champion: single entrant id once round 29 finalizes with one survivor.
  // coChampions: array of entrant ids on a GF tie (both survive). Exactly one
  // of the two is ever non-null; isComplete reflects either outcome.
  const isComplete = champion !== null || coChampions !== null;

  const cumulativeLadderList = Object.values(cumulativeLadder).sort((a, b) => b.grandTotal - a.grandTotal);

  return {
    weeks,
    currentWeek,
    champion,
    coChampions,
    isComplete,
    cumulativeLadder: cumulativeLadderList,
  };
}

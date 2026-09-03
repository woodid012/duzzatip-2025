// src/app/lib/rollingLockout.js
//
// Rolling lockout — a concession, not the default.
//
// If you got your team and tips in before the first bounce, nothing changes for
// you: everything locks firmly at the first bounce, exactly as it always did.
// You did the work by the deadline and your round is committed.
//
// Rolling lockout exists only for players who DIDN'T submit. Rather than being
// shut out of the whole round, they may still enter picks for games that haven't
// started yet:
//
//   • a selected player locks when that player's club game starts
//   • a tip (and its dead cert) locks when that match starts
//
// They're already down whatever the early games were worth, so there's nothing
// to farm — and they don't get to see anyone else's picks while they're still
// entering their own.
//
// These helpers are deliberately pure and dependency-free so the same rules run
// in the browser (to grey out controls) and on the server (to actually enforce
// them — a greyed-out button is a hint, not a lock).

// Squad records store abbreviated club codes; fixtures use full club names.
export const TEAM_CODE_TO_NAME = {
  ADE: 'Adelaide Crows',
  BRL: 'Brisbane Lions',
  CAR: 'Carlton',
  COL: 'Collingwood',
  ESS: 'Essendon',
  FRE: 'Fremantle',
  GCS: 'Gold Coast SUNS',
  GEE: 'Geelong Cats',
  GWS: 'GWS GIANTS',
  HAW: 'Hawthorn',
  MEL: 'Melbourne',
  NTH: 'North Melbourne',
  PTA: 'Port Adelaide',
  RIC: 'Richmond',
  STK: 'St Kilda',
  SYD: 'Sydney Swans',
  WBD: 'Western Bulldogs',
  WCE: 'West Coast Eagles',
};

// Positions each reserve can be called up into.
export const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
export const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];

function toTime(value) {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function nowMs(now) {
  if (now === undefined || now === null) return Date.now();
  return now instanceof Date ? now.getTime() : new Date(now).getTime();
}

/** Fixtures for a round, oldest kick-off first. */
export function roundFixtures(fixtures, round) {
  // Guard explicitly: Number(null) is 0, and silently answering for the Opening
  // Round when the caller hasn't resolved a round yet would report picks locked
  // that aren't.
  if (round === null || round === undefined || round === '') return [];
  const r = Number(round);
  if (!Number.isFinite(r)) return [];
  return (fixtures || [])
    .filter((f) => Number(f.RoundNumber) === r)
    .sort((a, b) => (toTime(a.DateUtc) ?? 0) - (toTime(b.DateUtc) ?? 0));
}

/** True once this fixture has bounced. Fixtures with no date are never started. */
export function hasStarted(fixture, now) {
  const start = toTime(fixture?.DateUtc);
  return start === null ? false : nowMs(now) >= start;
}

/** MatchNumbers in the round that have already started. */
export function startedMatchNumbers(fixtures, round, now) {
  return new Set(
    roundFixtures(fixtures, round)
      .filter((f) => hasStarted(f, now))
      .map((f) => Number(f.MatchNumber))
  );
}

/**
 * A single match's tip (and dead cert) is locked once that match starts.
 * Unknown match numbers are treated as locked — we can't verify them, and
 * accepting an unverifiable pick is the failure that actually costs points.
 */
export function isMatchLocked(fixtures, round, matchNumber, now) {
  const fixture = roundFixtures(fixtures, round).find(
    (f) => Number(f.MatchNumber) === Number(matchNumber)
  );
  if (!fixture) return true;
  return hasStarted(fixture, now);
}

/** Kick-off of the round's first game — the moment empty slots lock. */
export function firstGameStart(fixtures, round) {
  const fixs = roundFixtures(fixtures, round);
  if (fixs.length === 0) return null;
  const t = toTime(fixs[0].DateUtc);
  return t === null ? null : new Date(t);
}

/** Kick-off of the next game yet to start — the next thing that will lock. */
export function nextLockoutTime(fixtures, round, now) {
  const next = roundFixtures(fixtures, round).find((f) => !hasStarted(f, now));
  if (!next) return null;
  const t = toTime(next.DateUtc);
  return t === null ? null : new Date(t);
}

/** Every game in the round has started — nothing is editable any more. */
export function isRoundFullyLocked(fixtures, round, now) {
  const fixs = roundFixtures(fixtures, round);
  if (fixs.length === 0) return false;
  return fixs.every((f) => hasStarted(f, now));
}

/** Some but not all games have started — the rolling window. */
export function isRoundPartiallyLocked(fixtures, round, now) {
  const fixs = roundFixtures(fixtures, round);
  if (fixs.length === 0) return false;
  const started = fixs.filter((f) => hasStarted(f, now)).length;
  return started > 0 && started < fixs.length;
}

/**
 * Has the round's first game started? Below this line nothing is locked for
 * anybody; above it, whether you're locked depends on whether you submitted.
 */
export function hasRoundStarted(fixtures, round, now) {
  const first = firstGameStart(fixtures, round);
  return first ? nowMs(now) >= first.getTime() : false;
}

/**
 * A player who submitted before the first bounce is locked firmly from that
 * moment — the whole round, not game by game. Rolling lockout is only for
 * players who didn't submit.
 */
export function isFirmlyLocked({ fixtures, round, submittedOnTime, now } = {}) {
  if (!submittedOnTime) return false;
  return hasRoundStarted(fixtures, round, now);
}

/**
 * Why a tip (and its dead cert) can't be changed, or null if it's still open.
 * `submittedOnTime` means the player had tips saved before the first bounce.
 */
export function tipLockReason(fixtures, round, matchNumber, { now, submittedOnTime } = {}) {
  if (isFirmlyLocked({ fixtures, round, submittedOnTime, now })) return 'Tips submitted';
  return isMatchLocked(fixtures, round, matchNumber, now) ? 'Game started' : null;
}

export function isTipLocked(fixtures, round, matchNumber, opts) {
  return tipLockReason(fixtures, round, matchNumber, opts) !== null;
}

/**
 * Every match number in the round whose tip may no longer be written — all of
 * them once a player is firmly locked, otherwise just the ones underway.
 */
export function lockedTipMatchNumbers(fixtures, round, { now, submittedOnTime } = {}) {
  if (isFirmlyLocked({ fixtures, round, submittedOnTime, now })) {
    return new Set(roundFixtures(fixtures, round).map((f) => Number(f.MatchNumber)));
  }
  return startedMatchNumbers(fixtures, round, now);
}

/**
 * Kick-off of a club's game in a round, or null on a bye / unknown club.
 * Accepts either the squad's club code ("GEE") or a fixture's club name.
 */
export function clubGameStart(fixtures, round, club) {
  if (!club) return null;
  const name = TEAM_CODE_TO_NAME[club] ?? club;
  const game = roundFixtures(fixtures, round).find(
    (f) => f.HomeTeam === name || f.AwayTeam === name
  );
  if (!game) return null;
  const t = toTime(game.DateUtc);
  return t === null ? null : new Date(t);
}

/**
 * Why a team-selection position is locked, or null if it's still editable.
 *
 * `team` is the user's selection keyed by position: { [position]: { player_name,
 * backup_position } }. `clubOf(playerName)` resolves a player to their club
 * (code or name); returning null means bye/unknown, which never locks.
 *
 * Rule 0 comes first: if this player submitted before the first bounce, the
 * whole team is locked from the bounce. Rolling lockout below is only reached
 * by players who didn't submit.
 *
 * Then, in order:
 *   1. An empty slot locks at the round's first bounce — you can't fill a hole
 *      after seeing how the round is going.
 *   2. A filled slot locks when that player's own game starts.
 *   3. If a reserve who covers this position has already played, the position
 *      locks too. Otherwise you could swap in a player you know didn't play and
 *      farm the reserve's score after the fact.
 */
export function positionLockReason(team, position, { fixtures, round, clubOf, now, submittedOnTime } = {}) {
  // Rule 0 — submitted on time, so the round is committed
  if (isFirmlyLocked({ fixtures, round, submittedOnTime, now })) return 'Team submitted';

  const userTeam = team || {};
  const playerName = userTeam[position]?.player_name;
  const playerStarted = (name) => {
    if (!name) return false;
    const start = clubGameStart(fixtures, round, clubOf ? clubOf(name) : null);
    return start ? nowMs(now) >= start.getTime() : false;
  };

  // Rule 1 — empty slot
  if (!playerName) {
    const first = firstGameStart(fixtures, round);
    if (!first) return null;
    return nowMs(now) >= first.getTime() ? 'Round started' : null;
  }

  // Rule 2 — this player's game has started
  if (playerStarted(playerName)) return 'Game started';

  // Rule 3 — a reserve covering this position has already played
  if (RESERVE_A_POSITIONS.includes(position) && playerStarted(userTeam['Reserve A']?.player_name)) {
    return `Reserve A (${userTeam['Reserve A'].player_name}) played`;
  }
  if (RESERVE_B_POSITIONS.includes(position) && playerStarted(userTeam['Reserve B']?.player_name)) {
    return `Reserve B (${userTeam['Reserve B'].player_name}) played`;
  }
  const bench = userTeam['Bench'];
  if (bench?.player_name && bench?.backup_position === position && playerStarted(bench.player_name)) {
    return `Bench (${bench.player_name}) played`;
  }

  return null;
}

export function isPositionLocked(team, position, opts) {
  return positionLockReason(team, position, opts) !== null;
}

/**
 * Which of an incoming team selection may actually be written, given what's
 * already stored. A position is refused when it's locked under the stored team
 * (rules above) or when the incoming player's own game has already started —
 * no picking a player after you've watched them play.
 *
 * Returns { allowed, rejected: [{ position, reason }] }.
 */
export function filterWritablePositions(storedTeam, incomingPositions, { fixtures, round, clubOf, now, submittedOnTime } = {}) {
  const allowed = {};
  const rejected = [];

  for (const [position, data] of Object.entries(incomingPositions || {})) {
    const reason = positionLockReason(storedTeam, position, { fixtures, round, clubOf, now, submittedOnTime });
    if (reason) {
      rejected.push({ position, reason });
      continue;
    }
    const incomingStart = clubGameStart(fixtures, round, clubOf ? clubOf(data?.player_name) : null);
    if (incomingStart && nowMs(now) >= incomingStart.getTime()) {
      rejected.push({ position, reason: 'Incoming player has already played' });
      continue;
    }
    // The bench's coverage choice is a round-wide call, so it locks at the
    // first bounce even while the bench player's own game is still to come.
    if (
      position === 'Bench' &&
      data?.backup_position &&
      data.backup_position !== storedTeam?.['Bench']?.backup_position
    ) {
      const first = firstGameStart(fixtures, round);
      if (first && nowMs(now) >= first.getTime()) {
        rejected.push({ position, reason: 'Bench coverage locked at first bounce' });
        continue;
      }
    }
    allowed[position] = data;
  }

  return { allowed, rejected };
}

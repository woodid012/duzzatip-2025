import {
  clubGameStart,
  filterWritablePositions,
  firstGameStart,
  isMatchLocked,
  isPositionLocked,
  isRoundFullyLocked,
  isRoundPartiallyLocked,
  nextLockoutTime,
  positionLockReason,
  startedMatchNumbers,
} from '../src/app/lib/rollingLockout';

// A three-game round spread across a weekend: Friday night, Saturday
// afternoon, Sunday afternoon. The whole point of the rolling lockout is that
// these three lock at three different moments.
const FRI = '2026-04-10T09:50:00Z';
const SAT = '2026-04-11T03:45:00Z';
const SUN = '2026-04-12T05:10:00Z';

const fixtures = [
  { MatchNumber: 41, RoundNumber: 5, HomeTeam: 'Carlton',       AwayTeam: 'Collingwood',      DateUtc: FRI },
  { MatchNumber: 42, RoundNumber: 5, HomeTeam: 'Geelong Cats',  AwayTeam: 'Hawthorn',         DateUtc: SAT },
  { MatchNumber: 43, RoundNumber: 5, HomeTeam: 'Sydney Swans',  AwayTeam: 'Western Bulldogs', DateUtc: SUN },
  // A different round, to prove round filtering holds.
  { MatchNumber: 50, RoundNumber: 6, HomeTeam: 'Carlton',       AwayTeam: 'Essendon',         DateUtc: '2026-04-17T09:50:00Z' },
];

const BEFORE_FRI = new Date('2026-04-10T09:00:00Z');
const AFTER_FRI  = new Date('2026-04-10T10:30:00Z'); // Fri underway, Sat/Sun to come
const AFTER_SAT  = new Date('2026-04-11T04:30:00Z');
const AFTER_SUN  = new Date('2026-04-12T06:00:00Z');

describe('match-level lockout', () => {
  test('a match locks only once its own game commences', () => {
    expect(isMatchLocked(fixtures, 5, 41, BEFORE_FRI)).toBe(false);
    expect(isMatchLocked(fixtures, 5, 41, AFTER_FRI)).toBe(true);
    // Saturday and Sunday are still open while Friday night is underway —
    // this is the whole behaviour change.
    expect(isMatchLocked(fixtures, 5, 42, AFTER_FRI)).toBe(false);
    expect(isMatchLocked(fixtures, 5, 43, AFTER_FRI)).toBe(false);
    expect(isMatchLocked(fixtures, 5, 42, AFTER_SAT)).toBe(true);
    expect(isMatchLocked(fixtures, 5, 43, AFTER_SAT)).toBe(false);
  });

  test('a match number that is not in the round is treated as locked', () => {
    expect(isMatchLocked(fixtures, 5, 999, BEFORE_FRI)).toBe(true);
    // Round 6's game must not leak into round 5's answer.
    expect(isMatchLocked(fixtures, 5, 50, BEFORE_FRI)).toBe(true);
  });

  test('started match numbers grow as the round rolls on', () => {
    expect([...startedMatchNumbers(fixtures, 5, BEFORE_FRI)]).toEqual([]);
    expect([...startedMatchNumbers(fixtures, 5, AFTER_FRI)]).toEqual([41]);
    expect([...startedMatchNumbers(fixtures, 5, AFTER_SAT)]).toEqual([41, 42]);
    expect([...startedMatchNumbers(fixtures, 5, AFTER_SUN)]).toEqual([41, 42, 43]);
  });
});

describe('round-level state', () => {
  test('a round is only fully locked once every game has started', () => {
    expect(isRoundFullyLocked(fixtures, 5, AFTER_FRI)).toBe(false);
    expect(isRoundFullyLocked(fixtures, 5, AFTER_SAT)).toBe(false);
    expect(isRoundFullyLocked(fixtures, 5, AFTER_SUN)).toBe(true);
  });

  test('partially locked covers the rolling window only', () => {
    expect(isRoundPartiallyLocked(fixtures, 5, BEFORE_FRI)).toBe(false);
    expect(isRoundPartiallyLocked(fixtures, 5, AFTER_FRI)).toBe(true);
    expect(isRoundPartiallyLocked(fixtures, 5, AFTER_SUN)).toBe(false);
  });

  test('an unresolved round is never treated as Opening Round', () => {
    // Number(null) is 0 — answering for round 0 here would wrongly report the
    // Opening Round's picks as locked before a round has even been chosen.
    expect(isRoundFullyLocked(fixtures, null, AFTER_SUN)).toBe(false);
    expect(isRoundPartiallyLocked(fixtures, undefined, AFTER_SUN)).toBe(false);
    expect(firstGameStart(fixtures, null)).toBeNull();
    expect([...startedMatchNumbers(fixtures, null, AFTER_SUN)]).toEqual([]);
  });

  test('a round with no fixtures is neither locked nor partially locked', () => {
    expect(isRoundFullyLocked(fixtures, 99, AFTER_SUN)).toBe(false);
    expect(isRoundPartiallyLocked(fixtures, 99, AFTER_SUN)).toBe(false);
    expect(firstGameStart(fixtures, 99)).toBeNull();
  });

  test('next lockout points at the next game still to bounce', () => {
    expect(nextLockoutTime(fixtures, 5, BEFORE_FRI)).toEqual(new Date(FRI));
    expect(nextLockoutTime(fixtures, 5, AFTER_FRI)).toEqual(new Date(SAT));
    expect(nextLockoutTime(fixtures, 5, AFTER_SAT)).toEqual(new Date(SUN));
    expect(nextLockoutTime(fixtures, 5, AFTER_SUN)).toBeNull();
  });

  test('fixtures out of chronological order still resolve correctly', () => {
    const shuffled = [fixtures[2], fixtures[0], fixtures[1]];
    expect(firstGameStart(shuffled, 5)).toEqual(new Date(FRI));
    expect(nextLockoutTime(shuffled, 5, AFTER_FRI)).toEqual(new Date(SAT));
  });
});

describe('club kick-off lookup', () => {
  test('resolves squad club codes and full fixture names alike', () => {
    expect(clubGameStart(fixtures, 5, 'GEE')).toEqual(new Date(SAT));
    expect(clubGameStart(fixtures, 5, 'Geelong Cats')).toEqual(new Date(SAT));
    expect(clubGameStart(fixtures, 5, 'HAW')).toEqual(new Date(SAT));
  });

  test('a club on a bye has no kick-off, so it never locks', () => {
    expect(clubGameStart(fixtures, 5, 'ESS')).toBeNull();
    expect(clubGameStart(fixtures, 5, null)).toBeNull();
  });
});

// ── Team selection ──────────────────────────────────────────────────────────
const clubs = {
  'Patrick Cripps': 'CAR',     // Friday
  'Nick Daicos': 'COL',        // Friday
  'Tom Stewart': 'GEE',        // Saturday
  'Jai Newcombe': 'HAW',       // Saturday
  'Isaac Heeney': 'SYD',       // Sunday
  'Marcus Bontempelli': 'WBD', // Sunday
  'Zach Merrett': 'ESS',       // bye
};
const clubOf = (name) => clubs[name] ?? null;
const opts = (now) => ({ fixtures, round: 5, clubOf, now });

describe('position lockout', () => {
  const team = {
    'Full Forward': { player_name: 'Patrick Cripps' },   // Friday
    'Midfielder': { player_name: 'Tom Stewart' },        // Saturday
    'Ruck': { player_name: 'Isaac Heeney' },             // Sunday
    'Tackler': { player_name: 'Zach Merrett' },          // bye
  };

  test('a filled slot locks when that player takes the field, not before', () => {
    expect(isPositionLocked(team, 'Full Forward', opts(BEFORE_FRI))).toBe(false);
    expect(isPositionLocked(team, 'Full Forward', opts(AFTER_FRI))).toBe(true);
    // The Saturday and Sunday picks are untouched by Friday's bounce.
    expect(isPositionLocked(team, 'Midfielder', opts(AFTER_FRI))).toBe(false);
    expect(isPositionLocked(team, 'Ruck', opts(AFTER_FRI))).toBe(false);
    expect(isPositionLocked(team, 'Midfielder', opts(AFTER_SAT))).toBe(true);
    expect(isPositionLocked(team, 'Ruck', opts(AFTER_SAT))).toBe(false);
  });

  test('a player on a bye never locks their slot', () => {
    expect(isPositionLocked(team, 'Tackler', opts(AFTER_SUN))).toBe(false);
  });

  test('an empty slot locks at the first bounce of the round', () => {
    expect(isPositionLocked(team, 'Offensive', opts(BEFORE_FRI))).toBe(false);
    expect(positionLockReason(team, 'Offensive', opts(AFTER_FRI))).toBe('Round started');
  });

  test('a reserve who has played locks the positions it covers', () => {
    // Reserve A covers FF / TF / Ruck. Once it has played, you can't swap a
    // Sunday ruck out for someone you know did not play and farm the reserve.
    const withReserve = {
      ...team,
      'Reserve A': { player_name: 'Nick Daicos' }, // Friday — already played
    };
    expect(positionLockReason(withReserve, 'Ruck', opts(AFTER_FRI)))
      .toBe('Reserve A (Nick Daicos) played');
    // Reserve B's positions are unaffected by Reserve A.
    expect(isPositionLocked(withReserve, 'Midfielder', opts(AFTER_FRI))).toBe(false);
  });

  test('a bench player who has played locks the position they back up', () => {
    const withBench = {
      ...team,
      'Bench': { player_name: 'Patrick Cripps', backup_position: 'Midfielder' },
    };
    expect(positionLockReason(withBench, 'Midfielder', opts(AFTER_FRI)))
      .toBe('Bench (Patrick Cripps) played');
  });
});

describe('filterWritablePositions', () => {
  const stored = {
    'Full Forward': { player_name: 'Patrick Cripps' }, // Friday
    'Midfielder': { player_name: 'Tom Stewart' },      // Saturday
  };

  test('accepts changes to positions whose games are still to come', () => {
    const { allowed, rejected } = filterWritablePositions(
      stored,
      { 'Midfielder': { player_name: 'Jai Newcombe' } },
      opts(AFTER_FRI)
    );
    expect(Object.keys(allowed)).toEqual(['Midfielder']);
    expect(rejected).toEqual([]);
  });

  test('refuses a change to a position whose player has already played', () => {
    const { allowed, rejected } = filterWritablePositions(
      stored,
      { 'Full Forward': { player_name: 'Isaac Heeney' } },
      opts(AFTER_FRI)
    );
    expect(allowed).toEqual({});
    expect(rejected).toEqual([{ position: 'Full Forward', reason: 'Game started' }]);
  });

  test('refuses bringing in a player who has already played', () => {
    // The midfield slot is still open (Stewart plays Saturday), but Cripps
    // played on Friday — picking him now would be picking a known score.
    const { allowed, rejected } = filterWritablePositions(
      stored,
      { 'Midfielder': { player_name: 'Patrick Cripps' } },
      opts(AFTER_FRI)
    );
    expect(allowed).toEqual({});
    expect(rejected).toEqual([
      { position: 'Midfielder', reason: 'Incoming player has already played' },
    ]);
  });

  test('an empty slot is refused once the round has started', () => {
    // Rule 1: you cannot fill a hole after the first bounce, whoever you name.
    const { allowed, rejected } = filterWritablePositions(
      stored,
      { 'Ruck': { player_name: 'Isaac Heeney' } },
      opts(AFTER_FRI)
    );
    expect(allowed).toEqual({});
    expect(rejected).toEqual([{ position: 'Ruck', reason: 'Round started' }]);
    // ...but before it, the same save goes through.
    expect(Object.keys(
      filterWritablePositions(stored, { 'Ruck': { player_name: 'Isaac Heeney' } }, opts(BEFORE_FRI)).allowed
    )).toEqual(['Ruck']);
  });

  test('bench coverage is a round-wide call and locks at the first bounce', () => {
    const withBench = {
      ...stored,
      'Bench': { player_name: 'Isaac Heeney', backup_position: 'Midfielder' }, // Sunday
    };
    const change = { 'Bench': { player_name: 'Isaac Heeney', backup_position: 'Ruck' } };

    // Before the round starts the coverage choice is free.
    expect(filterWritablePositions(withBench, change, opts(BEFORE_FRI)).rejected).toEqual([]);
    // After the first bounce it is fixed, even though Heeney plays Sunday.
    expect(filterWritablePositions(withBench, change, opts(AFTER_FRI)).rejected).toEqual([
      { position: 'Bench', reason: 'Bench coverage locked at first bounce' },
    ]);
    // Swapping the bench player alone, coverage unchanged, is still allowed.
    const swap = { 'Bench': { player_name: 'Marcus Bontempelli', backup_position: 'Midfielder' } };
    expect(Object.keys(filterWritablePositions(withBench, swap, opts(AFTER_FRI)).allowed))
      .toEqual(['Bench']);
  });

  test('splits a mixed payload rather than refusing the whole save', () => {
    const { allowed, rejected } = filterWritablePositions(
      stored,
      {
        'Full Forward': { player_name: 'Nick Daicos' },  // locked (Friday)
        'Midfielder': { player_name: 'Jai Newcombe' },   // open (Saturday)
      },
      opts(AFTER_FRI)
    );
    expect(Object.keys(allowed)).toEqual(['Midfielder']);
    expect(rejected.map(r => r.position)).toEqual(['Full Forward']);
  });
});

import {
  recurringMatchupKeys,
  applyAflScores,
  matchupKey,
  placeholderRounds,
  roundsNeedingDateCheck,
  applyAflDates,
  toFixtureDate,
} from '../src/app/lib/fixtureCache';

// 2026's recurring fixture that triggered the bug: Hawthorn v Western Bulldogs
// plays in BOTH round 5 (MatchNumber 42) and round 13 (MatchNumber 108) with
// the same home/away orientation. Adelaide v Geelong also plays twice but with
// flipped orientation, so it must NOT be treated as recurring.
const fixtures = [
  { MatchNumber: 42,  RoundNumber: 5,  HomeTeam: 'Hawthorn',      AwayTeam: 'Western Bulldogs', DateUtc: '2026-04-10T08:00:00Z', HomeTeamScore: 104, AwayTeamScore: 64 },
  { MatchNumber: 108, RoundNumber: 13, HomeTeam: 'Hawthorn',      AwayTeam: 'Western Bulldogs', DateUtc: '2026-06-05T08:00:00Z', HomeTeamScore: 104, AwayTeamScore: 64 }, // contaminated with R5's score
  { MatchNumber: 22,  RoundNumber: 3,  HomeTeam: 'Geelong Cats',  AwayTeam: 'Adelaide Crows',   DateUtc: '2026-03-27T08:00:00Z', HomeTeamScore: 68,  AwayTeamScore: 60 },
  { MatchNumber: 107, RoundNumber: 13, HomeTeam: 'Adelaide Crows', AwayTeam: 'Geelong Cats',    DateUtc: '2026-06-05T08:00:00Z', HomeTeamScore: 75,  AwayTeamScore: 74 },
];

describe('recurringMatchupKeys', () => {
  test('flags same-orientation repeat matchups, not flipped ones', () => {
    const recurring = recurringMatchupKeys(fixtures);
    expect(recurring.has(matchupKey(fixtures[1]))).toBe(true);  // Hawthorn v WB
    expect(recurring.has(matchupKey(fixtures[3]))).toBe(false); // Adelaide v Geelong (flipped)
    expect(recurring.has(matchupKey(fixtures[2]))).toBe(false); // Geelong v Adelaide (flipped)
  });
});

describe('applyAflScores', () => {
  const key = (round, f) => `${round}|${matchupKey(f)}`;

  test('clears cross-round contamination when own round is not concluded', () => {
    // Round 13 Hawthorn v WB has not been played yet (live/scheduled, no score).
    const combined = {
      [key(13, fixtures[1])]: { homeScore: null, awayScore: null, status: 'SCHEDULED' },
    };
    const { fixtures: out, evaluated } = applyAflScores(fixtures, combined);
    const m108 = out.find(f => f.MatchNumber === 108);
    expect(m108.HomeTeamScore).toBeNull();   // stale 104 cleared
    expect(m108.AwayTeamScore).toBeNull();   // stale 64 cleared
    expect(evaluated.has(108)).toBe(true);
    // The round 5 original is untouched (no own-round entry supplied).
    expect(out.find(f => f.MatchNumber === 42).HomeTeamScore).toBe(104);
  });

  test('sets the real score once the own-round game concludes', () => {
    const combined = {
      [key(13, fixtures[1])]: { homeScore: 88, awayScore: 90, status: 'CONCLUDED' },
    };
    const { fixtures: out } = applyAflScores(fixtures, combined);
    const m108 = out.find(f => f.MatchNumber === 108);
    expect(m108.HomeTeamScore).toBe(88);
    expect(m108.AwayTeamScore).toBe(90);
  });

  test('does NOT clear a stored score when own-round status is unknown', () => {
    // Guards against an API hiccup briefly wiping a legitimate score.
    const combined = {
      [key(13, fixtures[1])]: { homeScore: null, awayScore: null, status: '' },
    };
    const { fixtures: out } = applyAflScores(fixtures, combined);
    const m108 = out.find(f => f.MatchNumber === 108);
    expect(m108.HomeTeamScore).toBe(104);
    expect(m108.AwayTeamScore).toBe(64);
  });

  test('leaves fixtures with no own-round API entry untouched and unevaluated', () => {
    const { fixtures: out, evaluated } = applyAflScores(fixtures, {});
    expect(out).toEqual(fixtures);
    expect(evaluated.size).toBe(0);
  });
});

// ── Fixture date self-heal ──────────────────────────────────────────────────
// Reconstruction of the 2026 finals lockout: Round 22 has been played, Rounds
// 23 (Preliminary Final) and 24 (Grand Final) still carry the seeded
// placeholder — every game on one day at 02:00Z — and R23's placeholder has
// already drifted into the past, locking the league out of entering finals
// teams and tips days before the round actually starts.
const scored = (round, n, home, away, date) =>
  ({ MatchNumber: n, RoundNumber: round, HomeTeam: home, AwayTeam: away, DateUtc: date, HomeTeamScore: 90, AwayTeamScore: 80 });
const unscored = (round, n, home, away, date) =>
  ({ MatchNumber: n, RoundNumber: round, HomeTeam: home, AwayTeam: away, DateUtc: date, HomeTeamScore: null, AwayTeamScore: null });

const finalsFixtures = [
  scored(21, 171, 'Carlton', 'Essendon', '2026-07-31 09:30:00Z'),
  scored(21, 172, 'Melbourne', 'Richmond', '2026-08-01 03:15:00Z'),
  scored(21, 173, 'Sydney Swans', 'Hawthorn', '2026-08-02 05:10:00Z'),
  scored(22, 181, 'Brisbane Lions', 'Hawthorn', '2026-08-07 09:40:00Z'),
  scored(22, 182, 'Geelong Cats', 'Essendon', '2026-08-08 06:35:00Z'),
  scored(22, 183, 'GWS GIANTS', 'Gold Coast SUNS', '2026-08-09 03:10:00Z'),
  unscored(23, 190, 'Brisbane Lions', 'Gold Coast SUNS', '2026-08-10 02:00:00Z'),
  unscored(23, 191, 'Essendon', 'Sydney Swans', '2026-08-10 02:00:00Z'),
  unscored(23, 192, 'GWS GIANTS', 'West Coast Eagles', '2026-08-10 02:00:00Z'),
  unscored(23, 198, 'Fremantle', 'Adelaide Crows', '2026-08-10 04:00:00Z'),
  unscored(24, 199, 'Collingwood', 'Brisbane Lions', '2026-08-17 02:00:00Z'),
  unscored(24, 200, 'Carlton', 'Fremantle', '2026-08-17 02:00:00Z'),
  unscored(24, 201, 'Essendon', 'Port Adelaide', '2026-08-17 02:00:00Z'),
  unscored(24, 207, 'West Coast Eagles', 'Hawthorn', '2026-08-17 04:00:00Z'),
];

describe('placeholderRounds', () => {
  test('flags rounds where 3+ games share one kickoff time', () => {
    const flagged = placeholderRounds(finalsFixtures);
    expect(flagged.has(23)).toBe(true);
    expect(flagged.has(24)).toBe(true);
  });

  test('does not flag properly staggered rounds', () => {
    const flagged = placeholderRounds(finalsFixtures);
    expect(flagged.has(21)).toBe(false);
    expect(flagged.has(22)).toBe(false);
  });
});

describe('roundsNeedingDateCheck', () => {
  test('picks up the placeholder finals rounds even though their dates are in the past', () => {
    // The bug's signature: R23's stored dates say it already started, so any
    // check that trusted DateUtc would skip the very round that needs fixing.
    expect(roundsNeedingDateCheck(finalsFixtures)).toEqual([23, 24]);
  });

  test('skips fully-scored rounds', () => {
    const rounds = roundsNeedingDateCheck(finalsFixtures);
    expect(rounds).not.toContain(21);
    expect(rounds).not.toContain(22);
  });

  test('is bounded so one page load cannot fan out across the season', () => {
    const wholeSeason = [];
    for (let r = 1; r <= 24; r++) {
      wholeSeason.push(unscored(r, r * 10, 'Carlton', 'Essendon', `2026-03-0${(r % 9) + 1} 02:00:00Z`));
    }
    expect(roundsNeedingDateCheck(wholeSeason).length).toBeLessThanOrEqual(6);
  });
});

describe('applyAflDates', () => {
  // Build the keys the same way the overlay does, so the test exercises the
  // real normalisation rather than a hand-typed guess at it.
  const dateKey = matchNumber => {
    const f = finalsFixtures.find(x => x.MatchNumber === matchNumber);
    return `${f.RoundNumber}|${matchupKey(f)}`;
  };
  const aflDates = {
    [dateKey(190)]: '2026-08-15 06:15:00Z', // Brisbane Lions v Gold Coast SUNS
    [dateKey(191)]: '2026-08-16 06:40:00Z', // Essendon v Sydney Swans
    [dateKey(192)]: '2026-08-16 03:40:00Z', // GWS GIANTS v West Coast Eagles
    [dateKey(198)]: '2026-08-14 10:10:00Z', // Fremantle v Adelaide Crows
  };

  test('replaces placeholder dates with the real AFL kickoff times', () => {
    const { fixtures: out, changes } = applyAflDates(finalsFixtures, aflDates);
    expect(changes).toHaveLength(4);
    expect(out.find(f => f.MatchNumber === 198).DateUtc).toBe('2026-08-14 10:10:00Z');
    expect(out.find(f => f.MatchNumber === 190).DateUtc).toBe('2026-08-15 06:15:00Z');
  });

  test('leaves rounds with no API entry untouched', () => {
    const { fixtures: out } = applyAflDates(finalsFixtures, aflDates);
    // Round 24 wasn't in the map — every one of its dates is unchanged.
    for (const f of out.filter(f => f.RoundNumber === 24)) {
      const before = finalsFixtures.find(o => o.MatchNumber === f.MatchNumber);
      expect(f.DateUtc).toBe(before.DateUtc);
    }
    expect(applyAflDates(finalsFixtures, {}).changes).toHaveLength(0);
  });

  test('reports no change when the stored date already matches', () => {
    const { changes } = applyAflDates(
      [unscored(23, 198, 'Fremantle', 'Adelaide Crows', '2026-08-14 10:10:00Z')],
      aflDates
    );
    expect(changes).toHaveLength(0);
  });

  test('keys by round, so a matchup recurring across rounds cannot cross-contaminate', () => {
    // Hawthorn v Western Bulldogs plays in both R5 and R13 with the same
    // orientation; an R5 date must never land on the R13 fixture.
    const { fixtures: out, changes } = applyAflDates(fixtures, {
      [`5|${matchupKey(fixtures[0])}`]: '2026-04-11 08:00:00Z',
    });
    expect(changes).toHaveLength(1);
    expect(out.find(f => f.MatchNumber === 42).DateUtc).toBe('2026-04-11 08:00:00Z');
    expect(out.find(f => f.MatchNumber === 108).DateUtc).toBe('2026-06-05T08:00:00Z');
  });
});

describe('toFixtureDate', () => {
  test('normalises AFL API timestamps to the stored fixture format', () => {
    // Must match refresh-fixtures.js byte for byte, or the CLI and the app
    // would flip the same fixture back and forth on every run.
    expect(toFixtureDate('2026-08-14T10:10:00.000+0000')).toBe('2026-08-14 10:10:00Z');
    expect(toFixtureDate('2026-08-15T06:15:00.000+0000')).toBe('2026-08-15 06:15:00Z');
  });
});

import { recurringMatchupKeys, applyAflScores, matchupKey } from '../src/app/lib/fixtureCache';

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

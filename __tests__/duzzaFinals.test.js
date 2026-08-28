import {
  computeWeekOutcome,
  computeDeadCertFromMatches,
  derivePlayerPool,
  DUZZA_FINALS_ROUNDS,
  DUZZA_FINALS_CUT_COUNTS,
  isDuzzaFinalsRound,
} from '../src/app/lib/duzzaFinals';

// ─── computeWeekOutcome ─────────────────────────────────────────────────────

describe('computeWeekOutcome', () => {
  test('clean bottom-2 cut with all distinct scores', () => {
    const scores = [
      { userId: 1, totalScore: 80 },
      { userId: 2, totalScore: 70 },
      { userId: 3, totalScore: 60 },
      { userId: 4, totalScore: 50 },
    ];
    const result = computeWeekOutcome(scores, 2);
    expect(new Set(result.eliminated)).toEqual(new Set([4, 3]));
    expect(new Set(result.survivors)).toEqual(new Set([1, 2]));
    // Survivors sorted highest score first
    expect(result.survivors).toEqual([1, 2]);
    expect(result.cutApplied).toBe(true);
    expect(result.tieAtCutLine).toBe(false);
  });

  test('tie at the cut line spares the whole tied group', () => {
    // Bottom 3 are tied at 50 — cutting only 2 of them is impossible, so
    // eliminating that group of 3 would overshoot cutCount=2. The whole
    // group survives instead.
    const scores = [
      { userId: 1, totalScore: 90 },
      { userId: 2, totalScore: 50 },
      { userId: 3, totalScore: 50 },
      { userId: 4, totalScore: 50 },
    ];
    const result = computeWeekOutcome(scores, 2);
    expect(result.eliminated).toEqual([]);
    expect(new Set(result.survivors)).toEqual(new Set([1, 2, 3, 4]));
    expect(result.cutApplied).toBe(false);
    expect(result.tieAtCutLine).toBe(true);
  });

  test('a tie among survivors (not at the cut line) does not affect the cut', () => {
    const scores = [
      { userId: 1, totalScore: 40 },
      { userId: 2, totalScore: 30 },
      { userId: 3, totalScore: 20 },
      { userId: 4, totalScore: 20 },
      { userId: 5, totalScore: 10 },
      { userId: 6, totalScore: 5 },
    ];
    // Bottom 2 (userId 6 @5, userId 5 @10) are cleanly distinct singleton
    // groups, so the cut lands cleanly even though 3/4 are tied above it.
    const result = computeWeekOutcome(scores, 2);
    expect(new Set(result.eliminated)).toEqual(new Set([6, 5]));
    expect(new Set(result.survivors)).toEqual(new Set([1, 2, 3, 4]));
    expect(result.tieAtCutLine).toBe(false);
  });

  test('cutCount >= field size eliminates everyone', () => {
    const scores = [
      { userId: 1, totalScore: 30 },
      { userId: 2, totalScore: 20 },
      { userId: 3, totalScore: 10 },
    ];
    const result = computeWeekOutcome(scores, 5);
    expect(result.eliminated.sort()).toEqual([1, 2, 3]);
    expect(result.survivors).toEqual([]);
  });

  test('all scores equal → nobody is cut', () => {
    const scores = [
      { userId: 1, totalScore: 42 },
      { userId: 2, totalScore: 42 },
      { userId: 3, totalScore: 42 },
    ];
    const result = computeWeekOutcome(scores, 2);
    expect(result.eliminated).toEqual([]);
    expect(new Set(result.survivors)).toEqual(new Set([1, 2, 3]));
    expect(result.cutApplied).toBe(false);
  });

  test('Grand Final cutCount=1 exact tie → both survive as co-champions', () => {
    const scores = [
      { userId: 1, totalScore: 88 },
      { userId: 2, totalScore: 88 },
    ];
    expect(DUZZA_FINALS_CUT_COUNTS[29]).toBe(1);
    const result = computeWeekOutcome(scores, DUZZA_FINALS_CUT_COUNTS[29]);
    expect(result.eliminated).toEqual([]);
    expect(new Set(result.survivors)).toEqual(new Set([1, 2]));
    expect(result.tieAtCutLine).toBe(true);
  });

  test('Grand Final head-to-head with a clear winner', () => {
    const scores = [
      { userId: 1, totalScore: 90 },
      { userId: 2, totalScore: 88 },
    ];
    const result = computeWeekOutcome(scores, 1);
    expect(result.eliminated).toEqual([2]);
    expect(result.survivors).toEqual([1]);
    expect(result.tieAtCutLine).toBe(false);
  });
});

// ─── computeDeadCertFromMatches ─────────────────────────────────────────────

describe('computeDeadCertFromMatches', () => {
  test('mix of correct dead cert (+6), wrong dead cert (-12), and plain tips', () => {
    const matches = [
      { correct: true, deadCert: true },   // +6
      { correct: false, deadCert: true },  // -12
      { correct: true, deadCert: false },  // 0 (correctTips++ only)
      { correct: false, deadCert: false }, // 0
    ];
    const result = computeDeadCertFromMatches(matches);
    expect(result.correctTips).toBe(2);
    expect(result.deadCertScore).toBe(6 - 12);
  });

  test('no matches → zero everything', () => {
    const result = computeDeadCertFromMatches([]);
    expect(result.correctTips).toBe(0);
    expect(result.deadCertScore).toBe(0);
  });

  test('all correct dead certs stack', () => {
    const matches = [
      { correct: true, deadCert: true },
      { correct: true, deadCert: true },
      { correct: true, deadCert: true },
    ];
    const result = computeDeadCertFromMatches(matches);
    expect(result.correctTips).toBe(3);
    expect(result.deadCertScore).toBe(18);
  });
});

// ─── derivePlayerPool ────────────────────────────────────────────────────────

describe('derivePlayerPool', () => {
  const playersByTeam = {
    FRE: [{ id: 1, name: 'Player Fremantle', teamName: 'FRE' }],
    HAW: [{ id: 2, name: 'Player Hawthorn', teamName: 'HAW' }],
    RIC: [{ id: 3, name: 'Player Richmond', teamName: 'RIC' }],
  };

  test('no fixtures for the round → fixturesKnown false, empty outputs', () => {
    const result = derivePlayerPool(playersByTeam, [], 26);
    expect(result.fixturesKnown).toBe(false);
    expect(result.teamsPlaying).toEqual([]);
    expect(result.playersByTeam).toEqual({});
  });

  test('playing teams included, non-playing (bye) teams excluded', () => {
    const fixtures = [
      { RoundNumber: 26, MatchNumber: 1, HomeTeam: 'Fremantle', AwayTeam: 'Hawthorn' },
    ];
    const result = derivePlayerPool(playersByTeam, fixtures, 26);
    expect(result.fixturesKnown).toBe(true);
    expect(new Set(result.teamsPlaying)).toEqual(new Set(['Fremantle', 'Hawthorn']));
    expect(Object.keys(result.playersByTeam).sort()).toEqual(['FRE', 'HAW']);
    expect(result.playersByTeam.RIC).toBeUndefined();
  });

  test('placeholder team names (unresolved finals matchups) are ignored', () => {
    const fixtures = [
      { RoundNumber: 27, MatchNumber: 1, HomeTeam: 'Winner of QF1', AwayTeam: 'Winner of QF2' },
      { RoundNumber: 27, MatchNumber: 2, HomeTeam: 'Fremantle', AwayTeam: 'Winner of EF1' },
    ];
    const result = derivePlayerPool(playersByTeam, fixtures, 27);
    // Fixtures exist for the round, so fixturesKnown is still true...
    expect(result.fixturesKnown).toBe(true);
    // ...but only the real club resolves as playing.
    expect(result.teamsPlaying).toEqual(['Fremantle']);
    expect(Object.keys(result.playersByTeam)).toEqual(['FRE']);
  });

  test('other Duzza Finals rounds are recognised', () => {
    expect(DUZZA_FINALS_ROUNDS).toEqual([26, 27, 28, 29]);
    expect(isDuzzaFinalsRound(28)).toBe(true);
    expect(isDuzzaFinalsRound(25)).toBe(false);
  });
});

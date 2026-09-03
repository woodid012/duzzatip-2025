import {
  computeWeekOutcome,
  computeDeadCertFromMatches,
  derivePlayerPool,
  splitEntrantsBySource,
  applyWeekToLadder,
  annotateTips,
  deriveBenchAndReserves,
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

// ─── splitEntrantsBySource ──────────────────────────────────────────────────

describe('splitEntrantsBySource', () => {
  test('splits core (knockout-eligible) from invited (open-registration) ids', () => {
    const entrants = [
      { EntrantId: 1, Source: 'core' },
      { EntrantId: 2, Source: 'core' },
      { EntrantId: 101, Source: 'invited' },
      { EntrantId: 102, Source: 'invited' },
    ];
    const result = splitEntrantsBySource(entrants);
    expect(result.coreIds).toEqual([1, 2]);
    expect(result.invitedIds).toEqual([101, 102]);
    expect(result.allIds).toEqual([1, 2, 101, 102]);
  });

  test('a missing/other Source is treated as core, not invited', () => {
    const entrants = [{ EntrantId: 5 }, { EntrantId: 6, Source: 'core' }];
    const result = splitEntrantsBySource(entrants);
    expect(result.coreIds).toEqual([5, 6]);
    expect(result.invitedIds).toEqual([]);
  });

  test('empty/undefined input → empty everything', () => {
    expect(splitEntrantsBySource([])).toEqual({ coreIds: [], invitedIds: [], allIds: [] });
    expect(splitEntrantsBySource(undefined)).toEqual({ coreIds: [], invitedIds: [], allIds: [] });
  });
});

// ─── applyWeekToLadder ──────────────────────────────────────────────────────

describe('applyWeekToLadder', () => {
  test('folds a week of scores into weeklyTotals + grandTotal, across rounds', () => {
    const ladder = {
      1: { userId: 1, weeklyTotals: {}, grandTotal: 0 },
      101: { userId: 101, weeklyTotals: {}, grandTotal: 0 },
    };
    applyWeekToLadder(ladder, [
      { userId: 1, totalScore: 80 },
      { userId: 101, totalScore: 55 },
    ], 26);
    applyWeekToLadder(ladder, [
      { userId: 1, totalScore: 40 },
      { userId: 101, totalScore: 60 },
    ], 27);

    expect(ladder[1].weeklyTotals).toEqual({ 26: 80, 27: 40 });
    expect(ladder[1].grandTotal).toBe(120);
    expect(ladder[101].weeklyTotals).toEqual({ 26: 55, 27: 60 });
    expect(ladder[101].grandTotal).toBe(115);
  });

  test('a score for an id not present in the ladder is silently ignored', () => {
    const ladder = { 1: { userId: 1, weeklyTotals: {}, grandTotal: 0 } };
    applyWeekToLadder(ladder, [{ userId: 999, totalScore: 50 }], 26);
    expect(ladder[1].grandTotal).toBe(0);
    expect(ladder[999]).toBeUndefined();
  });

  test('empty scores is a no-op', () => {
    const ladder = { 1: { userId: 1, weeklyTotals: {}, grandTotal: 0 } };
    applyWeekToLadder(ladder, [], 26);
    expect(ladder[1].weeklyTotals).toEqual({});
    expect(ladder[1].grandTotal).toBe(0);
  });
});

// ─── annotateTips ───────────────────────────────────────────────────────────

describe('annotateTips', () => {
  const roundFixtures = [
    { MatchNumber: 1, HomeTeam: 'Fremantle', AwayTeam: 'Hawthorn', HomeTeamScore: 80, AwayTeamScore: 70 },
    { MatchNumber: 2, HomeTeam: 'Richmond', AwayTeam: 'Carlton', HomeTeamScore: null, AwayTeamScore: null },
    { MatchNumber: 3, HomeTeam: 'Sydney Swans', AwayTeam: 'Essendon', HomeTeamScore: 60, AwayTeamScore: 60 },
  ];

  test('a correct tip against a completed match is marked correct: true', () => {
    const tips = [{ MatchNumber: 1, Tip: 'Fremantle', DeadCert: true }];
    const result = annotateTips(tips, roundFixtures);
    expect(result).toEqual([
      { matchNumber: 1, match: 'Fremantle v Hawthorn', tip: 'Fremantle', deadCert: true, correct: true },
    ]);
  });

  test('a wrong tip against a completed match is marked correct: false', () => {
    const tips = [{ MatchNumber: 1, Tip: 'Hawthorn', DeadCert: false }];
    const result = annotateTips(tips, roundFixtures);
    expect(result[0].correct).toBe(false);
  });

  test('a tip on an unresolved match is marked pending', () => {
    const tips = [{ MatchNumber: 2, Tip: 'Richmond', DeadCert: false }];
    const result = annotateTips(tips, roundFixtures);
    expect(result[0].correct).toBe('pending');
  });

  test('a draw never counts as a correct tip', () => {
    const tips = [{ MatchNumber: 3, Tip: 'Sydney Swans', DeadCert: false }];
    const result = annotateTips(tips, roundFixtures);
    expect(result[0].correct).toBe(false);
  });

  test('a stored Match label is preserved rather than rebuilt', () => {
    const tips = [{ MatchNumber: 1, Match: 'FRE v HAW (custom)', Tip: 'Fremantle', DeadCert: false }];
    const result = annotateTips(tips, roundFixtures);
    expect(result[0].match).toBe('FRE v HAW (custom)');
  });

  test('no tips → empty array', () => {
    expect(annotateTips([], roundFixtures)).toEqual([]);
    expect(annotateTips(undefined, roundFixtures)).toEqual([]);
  });
});

// ─── deriveBenchAndReserves ─────────────────────────────────────────────────

describe('deriveBenchAndReserves', () => {
  const team = [
    { position: 'Full Forward', playerName: 'Logan Morris' },
    { position: 'Tackler', playerName: 'James Rowbottom' },
    { position: 'Bench', playerName: 'Josh Dunkley', backupPosition: 'Tackler' },
    { position: 'Reserve A', playerName: 'Lachlan McAndrew' },
    { position: 'Reserve B', playerName: 'Patrick Cripps' },
  ];

  test('returns only bench and reserves, never the on-ground six', () => {
    const out = deriveBenchAndReserves(team, []);
    expect(out.map((b) => b.position)).toEqual(['Bench', 'Reserve A', 'Reserve B']);
  });

  test('bench covers just its nominated position, reserves their half of the ground', () => {
    const [bench, resA, resB] = deriveBenchAndReserves(team, []);
    expect(bench.covers).toEqual(['Tackler']);
    expect(resA.covers).toEqual(['Full Forward', 'Tall Forward', 'Ruck']);
    expect(resB.covers).toEqual(['Offensive', 'Midfielder', 'Tackler']);
  });

  test('shows the bench before anyone has played, when the scorer would drop them', () => {
    // The regression this guards: benchScores/reserveScores are empty until a
    // player has played, which hid the bench for the whole pre-game window.
    const out = deriveBenchAndReserves(team, []);
    expect(out).toHaveLength(3);
  });

  test('omits a player who has already substituted in', () => {
    // Once on, they appear in the position table under the position they
    // covered — listing them here too showed the same player twice.
    const positionScores = [
      { position: 'Tackler', playerName: 'Josh Dunkley', isBenchPlayer: true },
      { position: 'Full Forward', playerName: 'Logan Morris', isBenchPlayer: false },
    ];
    const out = deriveBenchAndReserves(team, positionScores);
    expect(out.map((b) => b.playerName)).toEqual(['Lachlan McAndrew', 'Patrick Cripps']);
    expect(out.some((b) => b.playerName === 'Josh Dunkley')).toBe(false);
  });

  test('a reserve who has come on is omitted too', () => {
    const positionScores = [
      { position: 'Ruck', playerName: 'Lachlan McAndrew', isBenchPlayer: true },
    ];
    const out = deriveBenchAndReserves(team, positionScores);
    expect(out.map((b) => b.position)).toEqual(['Bench', 'Reserve B']);
  });

  test('a bench player with no nominated backup covers nothing', () => {
    const out = deriveBenchAndReserves([{ position: 'Bench', playerName: 'Someone' }], []);
    expect(out[0].covers).toEqual([]);
    expect(out[0].backupPosition).toBeNull();
  });

  test('tolerates missing inputs', () => {
    expect(deriveBenchAndReserves(undefined, undefined)).toEqual([]);
    expect(deriveBenchAndReserves([], null)).toEqual([]);
  });
});

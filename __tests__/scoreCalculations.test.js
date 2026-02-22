import { calculateScore, didPlayerPlay, calculateTeamScores } from '../src/app/lib/scoreCalculations';

// ─── Individual position scoring ───────────────────────────────────────────────

describe('calculateScore', () => {
  test('returns 0 for null stats', () => {
    expect(calculateScore('Full Forward', null).total).toBe(0);
  });

  test('Full Forward: goals * 9 + behinds', () => {
    const stats = { goals: 3, behinds: 2, kicks: 0, handballs: 0, marks: 0, tackles: 0, hitouts: 0 };
    const result = calculateScore('Full Forward', stats);
    expect(result.total).toBe(3 * 9 + 2); // 29
  });

  test('Tall Forward: goals * 6 + marks * 2', () => {
    const stats = { goals: 2, marks: 5, kicks: 0, handballs: 0, behinds: 0, tackles: 0, hitouts: 0 };
    const result = calculateScore('Tall Forward', stats);
    expect(result.total).toBe(2 * 6 + 5 * 2); // 22
  });

  test('Midfielder: disposals capped at 30 base + 3x bonus', () => {
    const stats = { kicks: 20, handballs: 15, goals: 0, behinds: 0, marks: 0, tackles: 0, hitouts: 0 };
    const result = calculateScore('Midfielder', stats);
    // 35 disposals: 30 * 1 + 5 * 3 = 45
    expect(result.total).toBe(45);
  });

  test('Midfielder: under 30 disposals, no bonus', () => {
    const stats = { kicks: 12, handballs: 8, goals: 0, behinds: 0, marks: 0, tackles: 0, hitouts: 0 };
    const result = calculateScore('Midfielder', stats);
    expect(result.total).toBe(20); // 20 disposals, all at 1x
  });

  test('Offensive: goals * 7 + kicks', () => {
    const stats = { goals: 1, kicks: 15, handballs: 0, behinds: 0, marks: 0, tackles: 0, hitouts: 0 };
    const result = calculateScore('Offensive', stats);
    expect(result.total).toBe(1 * 7 + 15); // 22
  });

  test('Tackler: tackles * 4 + handballs', () => {
    const stats = { tackles: 8, handballs: 10, goals: 0, behinds: 0, kicks: 0, marks: 0, hitouts: 0 };
    const result = calculateScore('Tackler', stats);
    expect(result.total).toBe(8 * 4 + 10); // 42
  });

  test('Ruck: hitouts + marks (under 18 combined)', () => {
    const stats = { hitouts: 10, marks: 5, goals: 0, behinds: 0, kicks: 0, handballs: 0, tackles: 0 };
    const result = calculateScore('Ruck', stats);
    expect(result.total).toBe(15); // 10 + 5 = 15, under 18
  });

  test('Ruck: bonus marks when hitouts + marks > 18', () => {
    const stats = { hitouts: 15, marks: 8, goals: 0, behinds: 0, kicks: 0, handballs: 0, tackles: 0 };
    const result = calculateScore('Ruck', stats);
    // hitouts=15, so regularMarks = max(0, 18-15) = 3, bonusMarks = 8-3 = 5
    // total = 15 + 3 + 5*3 = 33
    expect(result.total).toBe(33);
  });

  test('Ruck: all hitouts, marks are all bonus', () => {
    const stats = { hitouts: 20, marks: 4, goals: 0, behinds: 0, kicks: 0, handballs: 0, tackles: 0 };
    const result = calculateScore('Ruck', stats);
    // hitouts=20 (>18), regularMarks = max(0, 18-20) = 0, bonusMarks = 4
    // total = 20 + 0 + 4*3 = 32
    expect(result.total).toBe(32);
  });

  test('Bench position uses backup position formula', () => {
    const stats = { goals: 2, behinds: 1, kicks: 0, handballs: 0, marks: 0, tackles: 0, hitouts: 0 };
    const result = calculateScore('BENCH', stats, 'Full Forward');
    expect(result.total).toBe(2 * 9 + 1); // 19, scored as Full Forward
  });

  test('unknown position returns 0', () => {
    const stats = { goals: 5, kicks: 10 };
    const result = calculateScore('Unknown Position', stats);
    expect(result.total).toBe(0);
  });

  test('handles zero stats gracefully', () => {
    const stats = { goals: 0, behinds: 0, kicks: 0, handballs: 0, marks: 0, tackles: 0, hitouts: 0 };
    const result = calculateScore('Full Forward', stats);
    expect(result.total).toBe(0);
  });
});

// ─── didPlayerPlay ─────────────────────────────────────────────────────────────

describe('didPlayerPlay', () => {
  test('returns false for null stats', () => {
    expect(didPlayerPlay(null)).toBe(false);
  });

  test('returns falsy for all-zero stats', () => {
    expect(didPlayerPlay({ kicks: 0, handballs: 0, marks: 0, tackles: 0, hitouts: 0, goals: 0, behinds: 0 })).toBeFalsy();
  });

  test('returns true if player has any stat > 0', () => {
    expect(didPlayerPlay({ kicks: 1, handballs: 0, marks: 0, tackles: 0, hitouts: 0, goals: 0, behinds: 0 })).toBe(true);
    expect(didPlayerPlay({ kicks: 0, handballs: 0, marks: 0, tackles: 3, hitouts: 0, goals: 0, behinds: 0 })).toBe(true);
    expect(didPlayerPlay({ kicks: 0, handballs: 0, marks: 0, tackles: 0, hitouts: 0, goals: 0, behinds: 2 })).toBe(true);
  });

  test('returns falsy for empty object', () => {
    expect(didPlayerPlay({})).toBeFalsy();
  });
});

// ─── calculateTeamScores ───────────────────────────────────────────────────────

describe('calculateTeamScores', () => {
  const makeTeamSelection = (players) => ({
    selectedPlayers: players
  });

  const makeStats = (overrides = {}) => ({
    kicks: 10, handballs: 5, marks: 3, tackles: 2, hitouts: 0, goals: 1, behinds: 1,
    ...overrides
  });

  test('calculates total score across all positions', () => {
    const team = makeTeamSelection([
      { position: 'Full Forward', playerName: 'PlayerA' },
      { position: 'Tall Forward', playerName: 'PlayerB' },
    ]);

    const statsMap = {
      'PlayerA': makeStats({ goals: 3, behinds: 0 }),  // FF: 3*9 = 27
      'PlayerB': makeStats({ goals: 1, marks: 4 }),     // TF: 1*6 + 4*2 = 14
    };

    const result = calculateTeamScores('user1', team, statsMap, 0, false);
    // Total should include both position scores
    expect(result.totalScore).toBe(27 + 14);
    expect(result.deadCertScore).toBe(0);
    expect(result.finalScore).toBe(27 + 14);
  });

  test('adds dead cert score to final score', () => {
    const team = makeTeamSelection([
      { position: 'Full Forward', playerName: 'PlayerA' },
    ]);

    const statsMap = {
      'PlayerA': makeStats({ goals: 2, behinds: 0 }),  // FF: 18
    };

    const result = calculateTeamScores('user1', team, statsMap, 6, false);
    expect(result.totalScore).toBe(18);
    expect(result.deadCertScore).toBe(6);
    expect(result.finalScore).toBe(24);
  });

  test('negative dead cert score subtracts from final', () => {
    const team = makeTeamSelection([
      { position: 'Full Forward', playerName: 'PlayerA' },
    ]);

    const statsMap = {
      'PlayerA': makeStats({ goals: 1, behinds: 0 }),  // FF: 9
    };

    const result = calculateTeamScores('user1', team, statsMap, -6, false);
    expect(result.finalScore).toBe(3);
  });

  test('bench player substitutes when scoring higher than starter', () => {
    const team = makeTeamSelection([
      { position: 'Full Forward', playerName: 'Starter' },
      { position: 'Bench', playerName: 'BenchGuy', backupPosition: 'Full Forward' },
    ]);

    const statsMap = {
      'Starter': makeStats({ goals: 1, behinds: 0 }),      // FF: 9
      'BenchGuy': makeStats({ goals: 3, behinds: 0 }),     // FF: 27
    };

    const result = calculateTeamScores('user1', team, statsMap, 0, false);
    const ffPosition = result.positionScores.find(p => p.position === 'Full Forward');
    expect(ffPosition.score).toBe(27);       // Bench player's score used
    expect(ffPosition.isBenchPlayer).toBe(true);
    expect(ffPosition.playerName).toBe('BenchGuy');
  });

  test('bench does NOT substitute when scoring lower', () => {
    const team = makeTeamSelection([
      { position: 'Full Forward', playerName: 'Starter' },
      { position: 'Bench', playerName: 'BenchGuy', backupPosition: 'Full Forward' },
    ]);

    const statsMap = {
      'Starter': makeStats({ goals: 3, behinds: 0 }),     // FF: 27
      'BenchGuy': makeStats({ goals: 1, behinds: 0 }),    // FF: 9
    };

    const result = calculateTeamScores('user1', team, statsMap, 0, false);
    const ffPosition = result.positionScores.find(p => p.position === 'Full Forward');
    expect(ffPosition.score).toBe(27);
    expect(ffPosition.isBenchPlayer).toBe(false);
    expect(ffPosition.playerName).toBe('Starter');
  });

  test('reserve substitutes for DNP player only when roundEndPassed', () => {
    const team = makeTeamSelection([
      { position: 'Full Forward', playerName: 'DNPPlayer' },
      { position: 'Reserve A', playerName: 'ReserveGuy' },
    ]);

    const statsMap = {
      'DNPPlayer': null,  // Did not play
      'ReserveGuy': makeStats({ goals: 2, behinds: 1 }), // plays
    };

    // Round not ended: reserve should NOT sub
    const resultBefore = calculateTeamScores('user1', team, statsMap, 0, false);
    const ffBefore = resultBefore.positionScores.find(p => p.position === 'Full Forward');
    expect(ffBefore.score).toBe(0);
    expect(ffBefore.isBenchPlayer).toBe(false);

    // Round ended: reserve SHOULD sub
    const resultAfter = calculateTeamScores('user1', team, statsMap, 0, true);
    const ffAfter = resultAfter.positionScores.find(p => p.position === 'Full Forward');
    expect(ffAfter.score).toBeGreaterThan(0);
    expect(ffAfter.isBenchPlayer).toBe(true);
    expect(ffAfter.replacementType).toBe('Reserve A');
  });

  test('handles empty team gracefully', () => {
    const team = makeTeamSelection([]);
    const result = calculateTeamScores('user1', team, {}, 0, false);
    expect(result.totalScore).toBe(0);
    expect(result.finalScore).toBe(0);
  });

  test('handles missing player stats', () => {
    const team = makeTeamSelection([
      { position: 'Full Forward', playerName: 'GhostPlayer' },
    ]);

    const result = calculateTeamScores('user1', team, {}, 0, false);
    const ffPosition = result.positionScores.find(p => p.position === 'Full Forward');
    expect(ffPosition.score).toBe(0);
    expect(ffPosition.hasPlayed).toBe(false);
  });
});

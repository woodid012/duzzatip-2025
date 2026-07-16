import {
  optimalAssignment,
  expectedBenchGain,
  optimiseLineup,
} from '../src/app/lib/lineupOptimiser';

// Two toy positions keep the arithmetic checkable by hand: MID pays kicks,
// OFF pays handballs.
const FNS = {
  MID: s => s.kicks,
  OFF: s => s.handballs,
};
const POSITIONS = ['MID', 'OFF'];

const mkGames = (kicksList, handballsList) =>
  kicksList.map((k, i) => ({ kicks: k, handballs: handballsList[i] }));

const player = (name, scores) => ({ name, scores });

const baseArgs = {
  scoreFns: FNS,
  positions: POSITIONS,
  reserveACovers: ['MID'],
  reserveBCovers: ['OFF'],
};

describe('optimalAssignment', () => {
  test('finds the max-total assignment where greedy-by-best-score fails', () => {
    // X is best at MID (50) but starting X at OFF (48) frees MID for Y (49).
    const X = player('X', { MID: 50, OFF: 48 });
    const Y = player('Y', { MID: 49, OFF: 10 });
    const { assign, score } = optimalAssignment([X, Y], POSITIONS);
    expect(assign.MID.name).toBe('Y');
    expect(assign.OFF.name).toBe('X');
    expect(score).toBe(97);
  });
});

describe('expectedBenchGain', () => {
  test('averages the clipped edge over every game pair', () => {
    // Pairs: (30-10)+=20, (30-50)+=0, twice each → 40/4 = 10
    expect(expectedBenchGain([30, 30], [10, 50])).toBe(10);
  });

  test('is 0 with an empty sample', () => {
    expect(expectedBenchGain([], [10])).toBe(0);
    expect(expectedBenchGain([10], null)).toBe(0);
  });
});

describe('optimiseLineup — bench backup position', () => {
  // M: all-or-nothing midfielder, mean 45. O: metronome at OFF, mean 45.
  // B: steady at both — MID mean 40 (−5 edge), OFF mean 48 (+3 edge).
  // The MEAN edge says back up OFF; the option value says MID, because when M
  // busts (10, 12) the bench's 40 swaps in: E[(40−M)+] = 14.5 vs OFF's 3.
  const M = player('M', { MID: 45, OFF: 0 });
  const O = player('O', { MID: 0, OFF: 45 });
  const B = player('B', { MID: 40, OFF: 48 });
  const W = player('W', { MID: 5, OFF: 5 });
  const statsMap = {
    M: { games: mkGames([10, 80, 12, 78], [0, 0, 0, 0]) },
    O: { games: mkGames([0, 0, 0, 0], [45, 45, 44, 46]) },
    B: { games: mkGames([40, 40, 40, 40], [48, 48, 48, 48]) },
    W: { games: mkGames([5, 5, 5, 5], [5, 5, 5, 5]) },
  };

  test('backs up the volatile starter over a small mean edge elsewhere', () => {
    const result = optimiseLineup({ ...baseArgs, squad: [M, O, B, W], statsMap });
    expect(result.lineup.MID.name).toBe('M');
    expect(result.lineup.OFF.name).toBe('O');
    expect(result.bench.name).toBe('B');
    expect(result.benchBackup).toBe('MID');
    expect(result.benchExpectedGain).toBe(14.5);
    // Options are auditable and sorted best-first
    expect(result.benchOptions[0].pos).toBe('MID');
    expect(result.benchOptions[0].value).toBeGreaterThan(result.benchOptions[1].value);
  });

  test('ties between "A starts / B benches" and the reverse keep the higher-mean starter on the field', () => {
    // max(starter, bench) is symmetric, so benching M behind B scores the same
    // expected total — the tie-break must keep the higher-mean lineup (M starts).
    const result = optimiseLineup({ ...baseArgs, squad: [M, O, B, W], statsMap });
    expect(result.lineup.MID.name).toBe('M');
    expect(result.bench.name).toBe('B');
  });

  test('a flagged (doubtful) starter pulls the bench cover toward its position', () => {
    // Everyone steady, no option value anywhere — but O is a late-out risk, and
    // the bench beats the leftover reserve cover, so backing OFF insures more.
    const M2 = player('M', { MID: 45, OFF: 0 });
    const O2 = player('O', { MID: 0, OFF: 45 });
    const B2 = player('B', { MID: 40, OFF: 40 });
    const W2 = player('W', { MID: 5, OFF: 5 });
    const steadyStats = {
      M: { games: mkGames([45, 45, 45, 45], [0, 0, 0, 0]) },
      O: { games: mkGames([0, 0, 0, 0], [45, 45, 45, 45]) },
      B: { games: mkGames([40, 40, 40, 40], [40, 40, 40, 40]) },
      W: { games: mkGames([5, 5, 5, 5], [5, 5, 5, 5]) },
    };
    const result = optimiseLineup({
      ...baseArgs, squad: [M2, O2, B2, W2], statsMap: steadyStats,
      riskOf: p => (p.name === 'O' ? 0.25 : 0.03),
    });
    expect(result.bench.name).toBe('B');
    expect(result.benchBackup).toBe('OFF');
  });

  test('falls back to the mean edge when the game sample is thin', () => {
    // B has only 2 games (< BENCH_MIN_GAMES): no variance info, so means
    // decide. The joint optimiser promotes B (OFF mean 48) into the lineup
    // and benches O (45) behind him — same expected total as B benching
    // behind O, and the tie-break keeps the higher-mean starters on field.
    const thinStats = { ...statsMap, B: { games: mkGames([40, 40], [48, 48]) } };
    const result = optimiseLineup({ ...baseArgs, squad: [M, O, B, W], statsMap: thinStats });
    expect(result.lineup.OFF.name).toBe('B');
    expect(result.bench.name).toBe('O');
    expect(result.benchBackup).toBe('OFF');
  });

  test('fills reserves from the leftovers after the bench', () => {
    const result = optimiseLineup({ ...baseArgs, squad: [M, O, B, W], statsMap });
    expect(result.reserveA.name).toBe('W');
    expect(result.reserveB).toBeNull();
  });
});

describe('optimiseLineup — degraded data', () => {
  test('no scores at all: fills every slot by squad order', () => {
    const squad = ['a', 'b', 'c', 'd', 'e'].map(n => player(n, {}));
    const result = optimiseLineup({ ...baseArgs, squad, statsMap: {} });
    expect(result.lineup.MID.name).toBe('a');
    expect(result.lineup.OFF.name).toBe('b');
    expect(result.bench.name).toBe('c');
    expect(result.reserveA.name).toBe('d');
    expect(result.reserveB.name).toBe('e');
  });

  test('pool too small for a bench: starters only', () => {
    const squad = [player('M', { MID: 45 }), player('O', { OFF: 45 })];
    const result = optimiseLineup({ ...baseArgs, squad, statsMap: {} });
    expect(result.lineup.MID.name).toBe('M');
    expect(result.lineup.OFF.name).toBe('O');
    expect(result.bench).toBeNull();
    expect(result.benchExpectedGain).toBe(0);
  });
});

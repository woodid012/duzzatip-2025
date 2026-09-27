import {
  ladderPercentage,
  tallyLadder,
  sortLadder,
  roundByRoundTotals,
} from '../src/app/lib/ladderTotals';

const users = { 1: 'Alpha', 2: 'Bravo', 3: 'Charlie', 4: 'Delta' };
const row = (rows, userId) => rows.find((r) => r.userId === userId);

describe('ladderPercentage', () => {
  test('is points for over points against, times 100, unrounded', () => {
    expect(ladderPercentage(150, 100)).toBe(150);
    expect(ladderPercentage(100, 300)).toBeCloseTo(33.3333, 4);
  });

  test('with no points against, it is points for times 100', () => {
    expect(ladderPercentage(120, 0)).toBe(12000);
  });

  test('with no points either way it is 0', () => {
    expect(ladderPercentage(0, 0)).toBe(0);
  });
});

describe('tallyLadder', () => {
  test('a win is 4 points, a loss 0, and points for/against both sides', () => {
    const rows = tallyLadder(users, [
      { round: 1, fixtures: [{ home: 1, away: 2 }], scores: { 1: 100, 2: 80 } },
    ]);
    expect(row(rows, '1')).toMatchObject({ played: 1, wins: 1, losses: 0, draws: 0, points: 4, pointsFor: 100, pointsAgainst: 80, percentage: 125 });
    expect(row(rows, '2')).toMatchObject({ played: 1, wins: 0, losses: 1, draws: 0, points: 0, pointsFor: 80, pointsAgainst: 100, percentage: 80 });
  });

  test('a draw is 2 points each', () => {
    const rows = tallyLadder(users, [
      { round: 1, fixtures: [{ home: 1, away: 2 }], scores: { 1: 90, 2: 90 } },
    ]);
    expect(row(rows, '1')).toMatchObject({ draws: 1, points: 2 });
    expect(row(rows, '2')).toMatchObject({ draws: 1, points: 2 });
  });

  test('0 v 0 is not played; a missing score counts as 0', () => {
    const rows = tallyLadder(users, [
      { round: 1, fixtures: [{ home: 1, away: 2 }, { home: 3, away: 4 }], scores: { 3: 50 } },
    ]);
    expect(row(rows, '1').played).toBe(0);
    expect(row(rows, '3')).toMatchObject({ played: 1, wins: 1, pointsFor: 50, pointsAgainst: 0, percentage: 5000 });
    expect(row(rows, '4')).toMatchObject({ played: 1, losses: 1, pointsFor: 0, pointsAgainst: 50, percentage: 0 });
  });

  test('a fixture naming an unknown user is ignored', () => {
    const rows = tallyLadder(users, [
      { round: 1, fixtures: [{ home: 1, away: 99 }], scores: { 1: 50, 99: 40 } },
    ]);
    expect(row(rows, '1').played).toBe(0);
  });

  test('onMatch sees each side of a played fixture, and extraFields seeds each row', () => {
    const seen = [];
    const rows = tallyLadder(
      users,
      [{ round: 3, fixtures: [{ home: 1, away: 2 }], scores: { 1: 60, 2: 70 } }],
      ({ row: r, userId, score, result, round }) => { seen.push([userId, score, result, round]); r.form.push(result); },
      () => ({ form: [] }),
    );
    expect(seen).toEqual([['1', 60, 'L', 3], ['2', 70, 'W', 3]]);
    expect(row(rows, '1').form).toEqual(['L']);
    expect(row(rows, '3').form).toEqual([]);
  });
});

describe('sortLadder', () => {
  test('ladder points first, then percentage — numbers or 2dp strings', () => {
    const rows = [
      { userId: 'a', points: 4, percentage: '90.00' },
      { userId: 'b', points: 8, percentage: '80.00' },
      { userId: 'c', points: 4, percentage: '110.50' },
    ];
    expect(sortLadder(rows).map((r) => r.userId)).toEqual(['b', 'c', 'a']);
    expect(sortLadder([{ userId: 'x', points: 0, percentage: 5 }, { userId: 'y', points: 0, percentage: 50 }]).map((r) => r.userId)).toEqual(['y', 'x']);
  });
});

describe('roundByRoundTotals', () => {
  test('counts the stored matchResult and sums points, with fallbacks', () => {
    const data = roundByRoundTotals([
      [1, { 1: { totalScore: 100, opponentScore: 80, matchResult: 'W' } }],
      [2, { 1: { totalScore: 70, pointsFor: 75, pointsAgainst: 90, matchResult: 'L' } }],
      [3, { 1: { totalScore: 60, opponentScore: 60, matchResult: 'D' } }],
    ]);
    const totals = data['1'].seasonTotals;
    expect(totals).toMatchObject({ wins: 1, losses: 1, draws: 1, played: 3, totalScore: 230, pointsFor: 235, pointsAgainst: 230 });
    expect(totals.percentage).toBeCloseTo((235 / 230) * 100, 10);
    expect(data['1'].rounds[2]).toMatchObject({ pointsFor: 75, pointsAgainst: 90, substitutionsUsed: [] });
  });

  test('no points against gives points for times 100; no result is not played', () => {
    const data = roundByRoundTotals([[1, { 2: { totalScore: 40 } }]]);
    expect(data['2'].seasonTotals).toMatchObject({ played: 0, percentage: 4000 });
  });
});

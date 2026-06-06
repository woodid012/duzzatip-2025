import { isSuspectRefresh } from '../src/app/lib/refreshGameResults';

describe('isSuspectRefresh', () => {
  test('allows the initial population of a round (nothing stored yet)', () => {
    expect(isSuspectRefresh(0, 0)).toBe(false);
    expect(isSuspectRefresh(0, 44)).toBe(false);
  });

  test('allows normal growth/refresh within a round', () => {
    expect(isSuspectRefresh(46, 92)).toBe(false);   // more games played
    expect(isSuspectRefresh(92, 92)).toBe(false);   // same data re-fetched
    expect(isSuspectRefresh(92, 91)).toBe(false);   // tiny correction
  });

  test('rejects an empty response when data is already stored', () => {
    expect(isSuspectRefresh(92, 0)).toBe(true);
  });

  test('rejects a drastic shrink (degraded AFL response)', () => {
    expect(isSuspectRefresh(92, 44)).toBe(true);    // only ~1 game returned
    expect(isSuspectRefresh(828, 46)).toBe(true);
  });
});

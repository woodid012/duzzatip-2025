import { isWeekInProgress } from '../src/app/finals/lib/roundStatus';

// The predicate both finals interfaces use to decide whether to open on their
// results view — "being played right now", not merely "locked" or "scheduled".
describe('isWeekInProgress', () => {
  const playing = { fixturesKnown: true, roundCommenced: true, roundComplete: false };

  it('is true once the first game has bounced and the week is unfinished', () => {
    expect(isWeekInProgress(playing)).toBe(true);
  });

  it('is false before the first bounce', () => {
    expect(isWeekInProgress({ ...playing, roundCommenced: false })).toBe(false);
  });

  it('is false once every game is final', () => {
    expect(isWeekInProgress({ ...playing, roundComplete: true })).toBe(false);
  });

  it('is false while the fixtures are still TBC', () => {
    expect(isWeekInProgress({ ...playing, fixturesKnown: false })).toBe(false);
  });

  it('is false for a week the bracket payload has no entry for', () => {
    expect(isWeekInProgress(null)).toBe(false);
    expect(isWeekInProgress(undefined)).toBe(false);
  });
});

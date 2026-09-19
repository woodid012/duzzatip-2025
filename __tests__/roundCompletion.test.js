import { storedScoresComplete } from '../src/app/lib/fixtureCache';

jest.mock('../src/app/lib/mongodb', () => ({ connectToDatabase: jest.fn() }));
jest.mock('../src/app/lib/refreshGameResults', () => ({
  refreshGameResultsForRound: jest.fn(),
  refreshStaleConcludedStats: jest.fn(),
}));

const YEAR = 2025; // a past season: loading its fixtures never touches the AFL API

const played = (round, matchNumber) => ({
  MatchNumber: matchNumber,
  RoundNumber: round,
  HomeTeam: 'Geelong Cats',
  AwayTeam: 'Collingwood',
  DateUtc: '2025-09-05 09:50:00Z',
  HomeTeamScore: 88,
  AwayTeamScore: 74,
});
const unplayed = (round, matchNumber) => ({
  ...played(round, matchNumber),
  HomeTeamScore: null,
  AwayTeamScore: null,
});

// Corroboration is the guard on latching a round as finished for every instance
// and for the rest of the season, so it gets tested on its own.
describe('storedScoresComplete', () => {
  test('agrees when every game in the round has a score', () => {
    expect(storedScoresComplete([played(27, 1), played(27, 2)], 27)).toBe(true);
  });

  test('disagrees when any game is still missing its score', () => {
    expect(storedScoresComplete([played(27, 1), unplayed(27, 2)], 27)).toBe(false);
  });

  test('cannot corroborate a round it has no fixtures for', () => {
    expect(storedScoresComplete([played(26, 1)], 27)).toBe(false);
    expect(storedScoresComplete([], 27)).toBe(false);
    expect(storedScoresComplete(undefined, 27)).toBe(false);
  });

  test('matches on the round it was asked about, not another one', () => {
    const fixtures = [played(26, 1), unplayed(27, 2)];
    expect(storedScoresComplete(fixtures, 26)).toBe(true);
    expect(storedScoresComplete(fixtures, 27)).toBe(false);
  });
});

// A fresh module per test: the in-process caches are module-level Maps, and the
// whole point of the shared layer is what happens when they're cold.
function loadModules({ shared = {} } = {}) {
  jest.resetModules();

  const getShared = jest.fn(async (key) => shared[key]);
  const setShared = jest.fn(async (key, value) => { shared[key] = value; });
  jest.doMock('../src/app/lib/sharedCache', () => ({
    getShared,
    setShared,
    claimStamp: jest.fn().mockResolvedValue(false),
  }));

  const fixtures = [played(27, 1), unplayed(28, 2)];
  const { connectToDatabase } = require('../src/app/lib/mongodb');
  connectToDatabase.mockResolvedValue({
    db: {
      collection: () => ({
        countDocuments: async () => fixtures.length,
        find: () => ({ toArray: async () => fixtures.map((f) => ({ ...f, year: YEAR })) }),
        bulkWrite: async () => ({}),
      }),
    },
  });

  return { ...require('../src/app/lib/fixtureCache'), getShared, setShared, shared };
}

describe('isRoundComplete across instances', () => {
  const key = (round) => `round-complete:${YEAR}:${round}`;

  test('an answer another instance already worked out is used as is', async () => {
    const { isRoundComplete, getShared } = loadModules({ shared: { [key(27)]: true } });
    global.fetch = jest.fn();

    await expect(isRoundComplete(27, YEAR)).resolves.toBe(true);

    expect(getShared).toHaveBeenCalledWith(key(27));
    expect(global.fetch).not.toHaveBeenCalled(); // nothing external was needed
    delete global.fetch;
  });

  test('a shared "not finished" is honoured too, so instances agree either way', async () => {
    const { isRoundComplete } = loadModules({ shared: { [key(28)]: false } });

    await expect(isRoundComplete(28, YEAR)).resolves.toBe(false);
  });

  test('a finished round is latched for everyone once the stored scores agree', async () => {
    const { isRoundComplete, setShared } = loadModules();

    await expect(isRoundComplete(27, YEAR)).resolves.toBe(true);

    const [, value, ttl] = setShared.mock.calls.find(([k]) => k === key(27));
    expect(value).toBe(true);
    expect(ttl).toBeGreaterThan(24 * 60 * 60 * 1000); // latched, not just cached
  });

  test('an unfinished round is only shared briefly, so it gets asked again', async () => {
    const { isRoundComplete, setShared } = loadModules();

    await expect(isRoundComplete(28, YEAR)).resolves.toBe(false);

    const [, value, ttl] = setShared.mock.calls.find(([k]) => k === key(28));
    expect(value).toBe(false);
    expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  test('a round other instances call finished is never un-finished', async () => {
    const { isRoundComplete, setShared } = loadModules({ shared: { [key(28)]: true } });

    await expect(isRoundComplete(28, YEAR)).resolves.toBe(true);
    expect(setShared).not.toHaveBeenCalled();
  });
});

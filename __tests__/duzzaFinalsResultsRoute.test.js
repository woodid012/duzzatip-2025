import { GET } from '../src/app/api/duzza-finals/results/route';
import { CURRENT_YEAR } from '../src/app/lib/constants';
import { connectToDatabase, connectToFinalsDatabase } from '../src/app/lib/mongodb';
import { syncFinalsFixtures } from '../src/app/lib/duzzaFinalsFixtures';
import { getSessionUser, ADMIN_UID } from '../src/app/lib/auth';
import { getFinalsSessionEntrant } from '../src/app/lib/duzzaFinalsAuth';
import { isRoundLocked } from '../src/app/lib/roundAccess';
import { getAflFixtures, isRoundComplete } from '../src/app/lib/fixtureCache';
import { refreshGameResultsForRound, refreshStaleConcludedStats } from '../src/app/lib/refreshGameResults';
import { getPlayerPoolForRound, computeWeeklyScores, computeBracket, seedEntrants } from '../src/app/lib/duzzaFinals';

jest.mock('../src/app/lib/mongodb', () => ({
  connectToDatabase: jest.fn(),
  connectToFinalsDatabase: jest.fn(),
}));
jest.mock('../src/app/lib/duzzaFinalsFixtures', () => ({ syncFinalsFixtures: jest.fn() }));
jest.mock('../src/app/lib/auth', () => ({ getSessionUser: jest.fn(), ADMIN_UID: 99 }));
jest.mock('../src/app/lib/duzzaFinalsAuth', () => ({ getFinalsSessionEntrant: jest.fn() }));
jest.mock('../src/app/lib/roundAccess', () => ({ isRoundLocked: jest.fn() }));
jest.mock('../src/app/lib/fixtureCache', () => ({
  getAflFixtures: jest.fn(),
  isRoundComplete: jest.fn(),
}));
jest.mock('../src/app/lib/refreshGameResults', () => ({
  refreshGameResultsForRound: jest.fn(),
  refreshStaleConcludedStats: jest.fn(),
}));
jest.mock('../src/app/lib/duzzaFinals', () => ({
  DUZZA_FINALS_ROUNDS: [26, 27, 28, 29],
  DUZZA_FINALS_WEEK_LABELS: { 26: 'Week 1' },
  isDuzzaFinalsRound: (round) => [26, 27, 28, 29].includes(round),
  getPlayerPoolForRound: jest.fn(),
  computeWeeklyScores: jest.fn(),
  computeBracket: jest.fn(),
  seedEntrants: jest.fn(),
}));

const entrants = [
  { EntrantId: 1, Name: 'Core One', Source: 'core' },
  { EntrantId: 2, Name: 'Core Two', Source: 'core' },
  { EntrantId: 101, Name: 'Guest', Source: 'invited' },
];
const seasonDb = {};
const finalsDb = {
  collection: (name) => ({
    find: () => ({
      toArray: async () => name.endsWith('_entrants')
        ? entrants
        : entrants.map((entrant) => ({ Entrant: entrant.EntrantId })),
    }),
  }),
};

function request(query = 'round=26&detail=1') {
  return new Request(`http://localhost/api/duzza-finals/results?${query}`);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  connectToDatabase.mockResolvedValue({ db: seasonDb });
  connectToFinalsDatabase.mockResolvedValue(finalsDb);
  syncFinalsFixtures.mockResolvedValue(undefined);
  getSessionUser.mockReturnValue(null);
  getFinalsSessionEntrant.mockReturnValue(null);
  isRoundLocked.mockResolvedValue(true);
  isRoundComplete.mockResolvedValue(false);
  getAflFixtures.mockResolvedValue([]);
  getPlayerPoolForRound.mockResolvedValue({ fixturesKnown: true });
  seedEntrants.mockResolvedValue(undefined);
  computeBracket.mockResolvedValue({ weeks: [] });
  refreshGameResultsForRound.mockResolvedValue(undefined);
  refreshStaleConcludedStats.mockResolvedValue(undefined);
  computeWeeklyScores.mockImplementation(async (_season, _finals, _round, _year, ids) =>
    ids.map((userId) => ({ userId, totalScore: 10 })));
});

test('normal polling returns current scores and lockout without forcing upstream refreshes', async () => {
  const response = await GET(request());
  const data = await response.json();

  expect(response.status).toBe(200);
  expect(data.locked).toBe(true);
  expect(data.entrantDetails.map((entrant) => entrant.userId)).toEqual([1, 2, 101]);
  expect(refreshGameResultsForRound).not.toHaveBeenCalled();
  expect(refreshStaleConcludedStats).not.toHaveBeenCalled();
  expect(getAflFixtures).not.toHaveBeenCalled();
});

test('manual refresh waits for live stats, completed stats, and fixtures before scoring', async () => {
  const liveStarted = deferred();
  const liveFinished = deferred();
  const staleStarted = deferred();
  const staleFinished = deferred();
  const fixturesStarted = deferred();
  const fixturesFinished = deferred();
  let totalScore = 10;
  refreshGameResultsForRound.mockImplementation(async () => {
    liveStarted.resolve();
    await liveFinished.promise;
    totalScore += 20;
  });
  refreshStaleConcludedStats.mockImplementation(async () => {
    staleStarted.resolve();
    await staleFinished.promise;
    totalScore += 30;
  });
  getAflFixtures.mockImplementation(async () => {
    fixturesStarted.resolve();
    await fixturesFinished.promise;
  });
  computeWeeklyScores.mockImplementation(async (_season, _finals, _round, _year, ids) =>
    ids.map((userId) => ({ userId, totalScore })));

  const pendingResponse = GET(request('round=26&detail=1&refresh=1'));
  await liveStarted.promise;
  expect(computeWeeklyScores).not.toHaveBeenCalled();
  expect(refreshGameResultsForRound).toHaveBeenCalledWith(26, { force: true, liveOnly: true });
  liveFinished.resolve();

  await staleStarted.promise;
  expect(computeWeeklyScores).not.toHaveBeenCalled();
  expect(refreshStaleConcludedStats).toHaveBeenCalledWith(26, { force: true });
  staleFinished.resolve();

  await fixturesStarted.promise;
  expect(computeWeeklyScores).not.toHaveBeenCalled();
  expect(getAflFixtures).toHaveBeenCalledWith(CURRENT_YEAR, { force: true });
  fixturesFinished.resolve();

  const data = await (await pendingResponse).json();
  expect(data.entrantDetails.map((entrant) => entrant.totalScore)).toEqual([60, 60, 60]);
});

test('stats refresh failures still return stored scores', async () => {
  refreshGameResultsForRound.mockRejectedValue(new Error('AFL unavailable'));
  refreshStaleConcludedStats.mockRejectedValue(new Error('AFL unavailable'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const response = await GET(request('round=26&detail=1&refresh=1'));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.entrantDetails[0].totalScore).toBe(10);
    expect(getAflFixtures).toHaveBeenCalledWith(CURRENT_YEAR, { force: true });
    expect(warn).toHaveBeenCalledTimes(2);
  } finally {
    warn.mockRestore();
  }
});

test.each(['25', '30', 'invalid', '26junk', '26.5', ''])('invalid round %j cannot start a forced refresh', async (round) => {
  const response = await GET(request(`round=${round}&detail=1&refresh=1`));
  expect(response.status).toBe(400);
  expect(syncFinalsFixtures).not.toHaveBeenCalled();
  expect(refreshGameResultsForRound).not.toHaveBeenCalled();
  expect(refreshStaleConcludedStats).not.toHaveBeenCalled();
  expect(getAflFixtures).not.toHaveBeenCalled();
});

test('historical detail requests never force current-season stats', async () => {
  const year = CURRENT_YEAR - 1;
  const response = await GET(request(`round=26&detail=1&refresh=1&year=${year}`));
  expect(response.status).toBe(200);
  expect(refreshGameResultsForRound).not.toHaveBeenCalled();
  expect(refreshStaleConcludedStats).not.toHaveBeenCalled();
  expect(getAflFixtures).not.toHaveBeenCalled();
  expect(computeWeeklyScores).toHaveBeenCalledWith(seasonDb, finalsDb, 26, year, [1, 2, 101], { detail: true });
});

test('bracket requests ignore refresh without a selected detail round', async () => {
  const response = await GET(request('refresh=1'));
  expect(await response.json()).toEqual({ year: CURRENT_YEAR, weeks: [] });
  expect(refreshGameResultsForRound).not.toHaveBeenCalled();
  expect(refreshStaleConcludedStats).not.toHaveBeenCalled();
  expect(getAflFixtures).not.toHaveBeenCalled();
});

test.each([
  ['anonymous', null, null, []],
  ['core', { uid: 1 }, null, [1]],
  ['invited', null, { entrantId: 101 }, [101]],
  ['admin', { uid: ADMIN_UID }, null, [1, 2, 101]],
])('manual refresh preserves pre-lockout privacy for %s viewers', async (_viewer, mainSession, finalsSession, visibleIds) => {
  isRoundLocked.mockResolvedValue(false);
  getSessionUser.mockReturnValue(mainSession);
  getFinalsSessionEntrant.mockReturnValue(finalsSession);

  const response = await GET(request('round=26&detail=1&refresh=1'));
  const data = await response.json();
  expect(data.locked).toBe(false);
  expect(data.entrantDetails.map((entrant) => entrant.userId)).toEqual(visibleIds);
  if (visibleIds.length === 0) {
    expect(computeWeeklyScores).not.toHaveBeenCalled();
  } else {
    expect(computeWeeklyScores).toHaveBeenCalledWith(seasonDb, finalsDb, 26, CURRENT_YEAR, visibleIds, { detail: true });
  }
});

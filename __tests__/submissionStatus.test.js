import { getAflFixtures } from '../src/app/lib/fixtureCache';
import {
  canSeeOthers,
  didSubmitOnTime,
  submittedOnTimeIds,
} from '../src/app/lib/submissionStatus';

jest.mock('../src/app/lib/fixtureCache', () => ({
  getAflFixtures: jest.fn(),
}));

// A round in the past so "now" is always after it; the individual tests choose
// how much of it has started by varying the fixture list.
const FRI = '2020-04-10T09:50:00Z';
const SUN = '2020-04-12T05:10:00Z';
const FUTURE = '2999-04-10T09:50:00Z';

const partlyPlayed = [
  { MatchNumber: 1, RoundNumber: 5, HomeTeam: 'Carlton', AwayTeam: 'Collingwood', DateUtc: FRI },
  // Still to come, so the round is underway but not finished with.
  { MatchNumber: 2, RoundNumber: 5, HomeTeam: 'Sydney Swans', AwayTeam: 'Hawthorn', DateUtc: FUTURE },
];
const allPlayed = [
  { MatchNumber: 1, RoundNumber: 5, HomeTeam: 'Carlton', AwayTeam: 'Collingwood', DateUtc: FRI },
  { MatchNumber: 2, RoundNumber: 5, HomeTeam: 'Sydney Swans', AwayTeam: 'Hawthorn', DateUtc: SUN },
];
const notStarted = [
  { MatchNumber: 1, RoundNumber: 5, HomeTeam: 'Carlton', AwayTeam: 'Collingwood', DateUtc: FUTURE },
];

// Minimal db stand-in: records the query it was handed and replays fixed rows.
function fakeDb(rowsByCollection) {
  const queries = [];
  return {
    queries,
    collection(name) {
      return {
        find(query) {
          queries.push({ name, query });
          const rows = (rowsByCollection[name] || []).filter((row) => {
            const field = Object.keys(query).find((k) => query[k]?.$lt !== undefined);
            if (!field) return true;
            return new Date(row[field]) < query[field].$lt;
          });
          return { toArray: async () => rows };
        },
      };
    },
  };
}

const BEFORE_BOUNCE = '2020-04-10T08:00:00Z';
const AFTER_BOUNCE = '2020-04-11T08:00:00Z';

// Player 1 got their team in on time; player 2 saved only after the bounce.
const teamRows = [
  { User: 1, Round: 5, Active: 1, Last_Updated: BEFORE_BOUNCE },
  { User: 2, Round: 5, Active: 1, Last_Updated: AFTER_BOUNCE },
];
// Nobody's tips were in on time.
const tipRows = [{ User: 1, Round: 5, Active: 1, LastUpdated: AFTER_BOUNCE }];

const db = () =>
  fakeDb({ '2026_team_selection': teamRows, '2026_tips': tipRows });

beforeEach(() => {
  getAflFixtures.mockReset();
  getAflFixtures.mockResolvedValue(partlyPlayed);
});

describe('submittedOnTimeIds', () => {
  test('counts only rows written before the first bounce', async () => {
    const ids = await submittedOnTimeIds(db(), 'team', 5, 2026);
    expect([...ids]).toEqual([1]);
  });

  test('nobody has submitted until the round actually starts', async () => {
    getAflFixtures.mockResolvedValue(notStarted);
    const ids = await submittedOnTimeIds(db(), 'team', 5, 2026);
    expect(ids.size).toBe(0);
  });

  test('a round with no fixtures yields nobody', async () => {
    const ids = await submittedOnTimeIds(db(), 'team', 99, 2026);
    expect(ids.size).toBe(0);
  });

  test('fails closed when fixtures cannot be read', async () => {
    getAflFixtures.mockRejectedValue(new Error('AFL API down'));
    const ids = await submittedOnTimeIds(db(), 'team', 5, 2026);
    expect(ids.size).toBe(0);
  });

  test('team and tips are separate gates', async () => {
    // Player 1 submitted a team on time but not tips.
    expect(await didSubmitOnTime(db(), 'team', 5, 1, 2026)).toBe(true);
    expect(await didSubmitOnTime(db(), 'tips', 5, 1, 2026)).toBe(false);
  });
});

describe('canSeeOthers', () => {
  test('a submitter sees everyone else once the round is under way', async () => {
    expect(await canSeeOthers(db(), 'team', 5, { isAdmin: false, viewerId: 1 }, 2026)).toBe(true);
  });

  test('a player still entering sees nobody else', async () => {
    // Player 2 missed the deadline — they keep the rolling window, and the
    // price of that is not seeing anyone else's team while they use it.
    expect(await canSeeOthers(db(), 'team', 5, { isAdmin: false, viewerId: 2 }, 2026)).toBe(false);
  });

  test('submitting a team does not unlock other players\' tips', async () => {
    expect(await canSeeOthers(db(), 'tips', 5, { isAdmin: false, viewerId: 1 }, 2026)).toBe(false);
  });

  test('a logged-out visitor cannot read the round mid-flight', async () => {
    // Without this, any player could bypass the whole rule from a private tab.
    expect(await canSeeOthers(db(), 'team', 5, { isAdmin: false, viewerId: null }, 2026)).toBe(false);
  });

  test('nobody sees anyone else before the first bounce', async () => {
    getAflFixtures.mockResolvedValue(notStarted);
    expect(await canSeeOthers(db(), 'team', 5, { isAdmin: false, viewerId: 1 }, 2026)).toBe(false);
  });

  test('everything opens up once every game has started', async () => {
    // Nothing can be entered any more, so there is nothing left to protect —
    // and history, the ladder, and the server-to-server rebuilds all depend on
    // this staying readable without a session.
    getAflFixtures.mockResolvedValue(allPlayed);
    expect(await canSeeOthers(db(), 'team', 5, { isAdmin: false, viewerId: 2 }, 2026)).toBe(true);
    expect(await canSeeOthers(db(), 'team', 5, { isAdmin: false, viewerId: null }, 2026)).toBe(true);
    expect(await canSeeOthers(db(), 'tips', 5, { isAdmin: false, viewerId: null }, 2026)).toBe(true);
  });

  test('admin always sees everything', async () => {
    getAflFixtures.mockResolvedValue(notStarted);
    expect(await canSeeOthers(db(), 'team', 5, { isAdmin: true, viewerId: null }, 2026)).toBe(true);
  });
});

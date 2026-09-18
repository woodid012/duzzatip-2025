import { POST } from '../src/app/api/duzza-finals/entry/route';
import { CURRENT_YEAR } from '../src/app/lib/constants';
import { connectToDatabase, connectToFinalsDatabase } from '../src/app/lib/mongodb';
import { getSessionUser } from '../src/app/lib/auth';
import { getFinalsSessionEntrant } from '../src/app/lib/duzzaFinalsAuth';
import { isRoundLocked } from '../src/app/lib/roundAccess';
import { getPlayerPoolForRound, seedEntrants } from '../src/app/lib/duzzaFinals';

jest.mock('../src/app/lib/mongodb', () => ({
  connectToDatabase: jest.fn(),
  connectToFinalsDatabase: jest.fn(),
}));
jest.mock('../src/app/lib/auth', () => ({ getSessionUser: jest.fn(), ADMIN_UID: 99 }));
jest.mock('../src/app/lib/duzzaFinalsAuth', () => ({ getFinalsSessionEntrant: jest.fn() }));
jest.mock('../src/app/lib/roundAccess', () => ({ isRoundLocked: jest.fn() }));
jest.mock('../src/app/lib/fixtureCache', () => ({ getAflFixtures: jest.fn() }));
jest.mock('../src/app/lib/duzzaFinals', () => ({
  DUZZA_FINALS_ROUNDS: [26, 27, 28, 29],
  DUZZA_FINALS_WEEK_LABELS: { 26: 'Qualifying & Elimination Finals' },
  isDuzzaFinalsRound: (round) => [26, 27, 28, 29].includes(round),
  getPlayerPoolForRound: jest.fn(),
  seedEntrants: jest.fn(),
}));

// The pool comp's player pool for the week — two clubs still playing.
const playersByTeam = {
  GEE: [{ id: 1, name: 'Jeremy Cameron' }, { id: 2, name: 'Tom Stewart' }],
  COL: [{ id: 3, name: 'Nick Daicos' }, { id: 4, name: 'Darcy Moore' }],
};

let updateOne;

function finalsDbWith(entrant) {
  return {
    collection: (name) => ({
      findOne: async () => (name.endsWith('_entrants') ? entrant : null),
      updateOne,
    }),
  };
}

function entryRequest(team) {
  return new Request('http://localhost/api/duzza-finals/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ round: 26, userId: 4, team, year: CURRENT_YEAR }),
  });
}

const fullTeam = () => ({
  'Full Forward': { player: 'Jeremy Cameron', club: 'GEE' },
  Midfielder: { player: 'Nick Daicos', club: 'COL' },
});

beforeEach(() => {
  jest.resetAllMocks();
  updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
  connectToDatabase.mockResolvedValue({ db: {} });
  connectToFinalsDatabase.mockResolvedValue(finalsDbWith({ EntrantId: 4, Name: 'Le Quack Attack' }));
  getSessionUser.mockReturnValue({ uid: 4 });
  getFinalsSessionEntrant.mockReturnValue(null);
  isRoundLocked.mockResolvedValue(false);
  seedEntrants.mockResolvedValue(undefined);
  getPlayerPoolForRound.mockResolvedValue({ fixturesKnown: true, playersByTeam });
});

test('saves a team with every position on a different player', async () => {
  const res = await POST(entryRequest(fullTeam()));

  expect(res.status).toBe(200);
  expect(updateOne).toHaveBeenCalledTimes(1);
  expect(updateOne.mock.calls[0][1].$set.Team).toEqual(fullTeam());
});

test('refuses a team with the same player in two positions', async () => {
  const team = { ...fullTeam(), Tackler: { player: 'Nick Daicos', club: 'COL' } };

  const res = await POST(entryRequest(team));

  expect(res.status).toBe(400);
  await expect(res.json()).resolves.toEqual({
    error: 'A player can only fill one position — Nick Daicos in Midfielder and Tackler',
  });
  expect(updateOne).not.toHaveBeenCalled();
});

test('names every duplicated player when a team repeats more than one', async () => {
  const team = {
    ...fullTeam(),
    Tackler: { player: 'Nick Daicos', club: 'COL' },
    'Reserve A': { player: 'Jeremy Cameron', club: 'GEE' },
  };

  const res = await POST(entryRequest(team));

  expect(res.status).toBe(400);
  const { error } = await res.json();
  expect(error).toContain('Jeremy Cameron in Full Forward and Reserve A');
  expect(error).toContain('Nick Daicos in Midfielder and Tackler');
  expect(updateOne).not.toHaveBeenCalled();
});

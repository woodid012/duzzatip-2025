import { computeBracket } from '../src/app/lib/duzzaFinals';
import { getAflFixtures, isRoundComplete } from '../src/app/lib/fixtureCache';
import { calculateTeamScores } from '../src/app/lib/scoreCalculations';

jest.mock('../src/app/lib/fixtureCache', () => ({
  getAflFixtures: jest.fn(),
  isRoundComplete: jest.fn(),
}));
jest.mock('../src/app/lib/scoreCalculations', () => ({
  // Scores an entry off the stats actually in game_results — so a round whose
  // stats are missing scores everyone zero, exactly as it does in production.
  calculateTeamScores: jest.fn((entrantId, team, statsMap) => {
    const totalScore = (team.selectedPlayers || []).reduce(
      (sum, p) => sum + (statsMap[p.playerName]?.points || 0),
      0
    );
    return { totalScore, finalScore: totalScore, positionScores: [] };
  }),
}));

const YEAR = 2026;
const CORE_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const HOUR = 60 * 60 * 1000;

// Rounds 26 and 27 are done; 28 (the Preliminary Finals — "week 3") is under way.
const fixtures = [
  { RoundNumber: 26, HomeTeam: 'Geelong Cats', AwayTeam: 'Collingwood', DateUtc: new Date(Date.now() - 14 * 24 * HOUR).toISOString() },
  { RoundNumber: 27, HomeTeam: 'Geelong Cats', AwayTeam: 'Carlton', DateUtc: new Date(Date.now() - 7 * 24 * HOUR).toISOString() },
  { RoundNumber: 28, HomeTeam: 'Collingwood', AwayTeam: 'Carlton', DateUtc: new Date(Date.now() - HOUR).toISOString() },
  { RoundNumber: 29, HomeTeam: 'Geelong Cats', AwayTeam: 'Collingwood', DateUtc: new Date(Date.now() + 6 * 24 * HOUR).toISOString() },
];

// Every core entrant picks one player of their own, so a round's stats decide
// the order: P1 tops the week, P8 props it up.
const entryFor = (entrantId, round) => ({
  Entrant: entrantId,
  Round: round,
  Team: { 'Full Forward': { player: `P${entrantId}`, club: 'GEE' } },
  Tips: [],
});

// Distinct scores, so each week's bottom two are unambiguous.
const statsFor = (ids) => ids.map((id) => ({ player_name: `P${id}`, points: 100 - id, team_name: 'Geelong Cats', round: 0 }));

function makeDbs({ roundsWithStats }) {
  const entrants = CORE_IDS.map((id) => ({ EntrantId: id, Name: `Team ${id}`, Source: 'core' }));
  const entries = [26, 27, 28].flatMap((round) => CORE_IDS.map((id) => entryFor(id, round)));

  const gameResultsFor = (round) => (roundsWithStats.includes(round) ? statsFor(CORE_IDS) : []);

  const seasonDb = {
    collection: (name) => ({
      find: (filter = {}) => ({
        toArray: async () => {
          if (name.endsWith('_players')) {
            return CORE_IDS.map((id) => ({ player_id: id, player_name: `P${id}`, team_name: 'GEE' }));
          }
          return gameResultsFor(Number(filter.round));
        },
      }),
      aggregate: () => ({ toArray: async () => [] }),
      countDocuments: async (filter = {}) => gameResultsFor(Number(filter.round)).length,
    }),
  };

  const finalsDb = {
    collection: (name) => ({
      bulkWrite: async () => ({}),
      find: (filter = {}) => ({
        toArray: async () =>
          name.endsWith('_entrants')
            ? entrants
            : entries.filter((e) => e.Round === Number(filter.Round)),
      }),
    }),
  };

  return { seasonDb, finalsDb };
}

const weekFor = (bracket, round) => bracket.weeks.find((w) => w.round === round);

beforeEach(() => {
  jest.clearAllMocks();
  getAflFixtures.mockResolvedValue(fixtures);
  isRoundComplete.mockImplementation(async (round) => round === 26 || round === 27);
});

test('week 3 starts with the 4 teams left after two cuts of two', async () => {
  const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26, 27, 28] });

  const bracket = await computeBracket(seasonDb, finalsDb, YEAR);

  expect(weekFor(bracket, 26).scores).toHaveLength(8);
  expect(weekFor(bracket, 27).scores).toHaveLength(6);
  expect(weekFor(bracket, 28).aliveAtStart).toHaveLength(4);
  expect(weekFor(bracket, 28).scores).toHaveLength(4);
  expect(weekFor(bracket, 28).aliveAtStart).toEqual([1, 2, 3, 4]);
});

// The bug this covers: game_results is rebuilt in place, so a read could land
// while a round had no stats. Every team then scored zero, computeWeekOutcome
// read the field as tied at the cut and spared all of it, and week 3 rendered
// 6 teams until the next poll put it back to 4.
test('a completed round with no stats yet does not spare the field', async () => {
  const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26] });

  const bracket = await computeBracket(seasonDb, finalsDb, YEAR);

  const semis = weekFor(bracket, 27);
  expect(semis.eliminated).toBeNull();
  expect(semis.tieAtCutLine).toBe(false);

  const prelims = weekFor(bracket, 28);
  expect(prelims.aliveAtStart).toBeNull();
  expect(prelims.scores).toHaveLength(0);
});

test('the same stats-less round finalizes normally once its stats land', async () => {
  const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26, 27] });

  const bracket = await computeBracket(seasonDb, finalsDb, YEAR);

  expect(weekFor(bracket, 26).eliminated).toEqual([8, 7]);
  expect(weekFor(bracket, 27).eliminated).toEqual([6, 5]);
  expect(weekFor(bracket, 28).aliveAtStart).toHaveLength(4);
});

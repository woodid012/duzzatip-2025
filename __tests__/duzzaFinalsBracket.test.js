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

// Rounds 26 and 27 are done and scored; 28 (the Preliminary Finals — "week 3")
// is under way, so its game has no score yet; 29 is still to come.
const fixtures = [
  { RoundNumber: 26, HomeTeam: 'Geelong Cats', AwayTeam: 'Collingwood', DateUtc: new Date(Date.now() - 14 * 24 * HOUR).toISOString(), HomeTeamScore: 88, AwayTeamScore: 74 },
  { RoundNumber: 27, HomeTeam: 'Geelong Cats', AwayTeam: 'Carlton', DateUtc: new Date(Date.now() - 7 * 24 * HOUR).toISOString(), HomeTeamScore: 95, AwayTeamScore: 60 },
  { RoundNumber: 28, HomeTeam: 'Collingwood', AwayTeam: 'Carlton', DateUtc: new Date(Date.now() - HOUR).toISOString(), HomeTeamScore: null, AwayTeamScore: null },
  { RoundNumber: 29, HomeTeam: 'Geelong Cats', AwayTeam: 'Collingwood', DateUtc: new Date(Date.now() + 6 * 24 * HOUR).toISOString(), HomeTeamScore: null, AwayTeamScore: null },
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
const statsFor = (ids) => ids.map((id) => ({ player_name: `P${id}`, points: 100 - id, team_name: 'Geelong Cats' }));

function makeDbs({ roundsWithStats, reads = [] }) {
  const entrants = CORE_IDS.map((id) => ({ EntrantId: id, Name: `Team ${id}`, Source: 'core' }));
  const entries = [26, 27, 28].flatMap((round) => CORE_IDS.map((id) => entryFor(id, round)));

  const gameResultsFor = (round) => (roundsWithStats.includes(round) ? statsFor(CORE_IDS) : []);

  // The bracket reads all four rounds' stats in one query, so the fake honours
  // both a single round and a { $in: [...] } batch.
  const roundsIn = (filter) =>
    Array.isArray(filter?.round?.$in) ? filter.round.$in.map(Number) : [Number(filter?.round)];

  const seasonDb = {
    collection: (name) => ({
      find: (filter = {}) => ({
        toArray: async () => {
          reads.push(name);
          if (name.endsWith('_players')) {
            return CORE_IDS.map((id) => ({ player_id: id, player_name: `P${id}`, team_name: 'GEE' }));
          }
          return roundsIn(filter).flatMap((round) =>
            gameResultsFor(round).map((row) => ({ ...row, round }))
          );
        },
      }),
      aggregate: () => ({ toArray: async () => [] }),
      countDocuments: async (filter = {}) =>
        roundsIn(filter).reduce((n, round) => n + gameResultsFor(round).length, 0),
    }),
  };

  // Decided weeks land here, like `${year}_week_results` in the finals DB.
  const frozenStore = new Map();

  const finalsDb = {
    frozenStore,
    collection: (name) => ({
      bulkWrite: async () => ({}),
      updateOne: async (filter, update) => {
        if (name.endsWith('_week_results')) frozenStore.set(Number(filter.round), update.$set);
        return {};
      },
      find: (filter = {}) => ({
        toArray: async () => {
          reads.push(name);
          if (name.endsWith('_week_results')) return [...frozenStore.values()];
          if (name.endsWith('_entrants')) return entrants;
          const wanted = Array.isArray(filter?.Round?.$in)
            ? filter.Round.$in.map(Number)
            : [Number(filter?.Round)];
          return entries.filter((e) => wanted.includes(e.Round));
        },
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

// The bracket is recomputed on every poll, so its cost is the dashboard's
// cost: one query per collection for all four rounds at once, one completion
// check per round with fixtures, and no touching the player list (all the
// bracket wants from the pool is whether the round has fixtures at all).
describe('computeBracket batches its reads', () => {
  test('reads each collection once, not once per round', async () => {
    const reads = [];
    const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26, 27, 28], reads });

    await computeBracket(seasonDb, finalsDb, YEAR);

    const countOf = (suffix) => reads.filter((name) => name.endsWith(suffix)).length;
    expect(countOf('_game_results')).toBe(1);
    expect(countOf('_entries')).toBe(1);
    expect(countOf('_entrants')).toBe(1);
    expect(countOf('_players')).toBe(0);
  });

  test('asks whether a round is complete once per round with fixtures', async () => {
    const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26, 27, 28] });

    await computeBracket(seasonDb, finalsDb, YEAR);

    // All four finals rounds have fixtures in this fixture list.
    expect(isRoundComplete).toHaveBeenCalledTimes(4);
    expect(isRoundComplete.mock.calls.map(([round]) => round)).toEqual([26, 27, 28, 29]);
  });

  test('a round with no fixtures is never asked about', async () => {
    getAflFixtures.mockResolvedValue(fixtures.filter((f) => f.RoundNumber !== 29));
    const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26, 27, 28] });

    await computeBracket(seasonDb, finalsDb, YEAR);

    expect(isRoundComplete.mock.calls.map(([round]) => round)).toEqual([26, 27, 28]);
  });
});

// A round the AFL calls concluded can still have a game with no score in the
// fixtures (a feed gap). Tips and dead certs settle per game, so deciding the
// week then would cut without that game's dead certs — and name the next
// week's matchup off it.
describe('a week is only decided once every game in it has a score', () => {
  const withUnscoredSemi = fixtures.flatMap((f) =>
    f.RoundNumber === 27
      ? [f, { ...f, HomeTeam: 'Hawthorn', AwayTeam: 'Brisbane Lions', DateUtc: f.DateUtc, HomeTeamScore: null, AwayTeamScore: null }]
      : [f]
  );

  test('a complete round with an unscored game is left undecided', async () => {
    getAflFixtures.mockResolvedValue(withUnscoredSemi);
    const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26, 27, 28] });

    const bracket = await computeBracket(seasonDb, finalsDb, YEAR);

    const semis = weekFor(bracket, 27);
    expect(semis.roundComplete).toBe(true);
    expect(semis.eliminated).toBeNull();
    expect(semis.scores).toHaveLength(6); // still shown live, just not cut
    expect(weekFor(bracket, 28).aliveAtStart).toBeNull();
    expect(finalsDb.frozenStore.has(27)).toBe(false);
  });

  test('the same round decides normally once the score lands', async () => {
    const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26, 27, 28] });

    const bracket = await computeBracket(seasonDb, finalsDb, YEAR);

    expect(weekFor(bracket, 27).eliminated).toEqual([6, 5]);
    expect(weekFor(bracket, 28).aliveAtStart).toEqual([1, 2, 3, 4]);
  });
});

// Results don't change the week after the game. A decided week is frozen and
// read back as decided, whatever the live inputs say later — only Refresh
// re-derives it.
describe('decided weeks are frozen', () => {
  test('finalizing a week writes it to the freezer', async () => {
    const { seasonDb, finalsDb } = makeDbs({ roundsWithStats: [26, 27, 28] });

    await computeBracket(seasonDb, finalsDb, YEAR);

    expect([...finalsDb.frozenStore.keys()].sort()).toEqual([26, 27]);
    expect(finalsDb.frozenStore.get(27).week.eliminated).toEqual([6, 5]);
    expect(finalsDb.frozenStore.get(27).ladderScores).toHaveLength(8);
  });

  test('a frozen week reads back as decided even if its inputs have since gone', async () => {
    const dbs = makeDbs({ roundsWithStats: [26, 27, 28] });
    await computeBracket(dbs.seasonDb, dbs.finalsDb, YEAR);

    // The Semis' stats vanish (a refresh gap) and the AFL API forgets the round.
    const later = makeDbs({ roundsWithStats: [26, 28] });
    later.finalsDb.frozenStore.set(27, dbs.finalsDb.frozenStore.get(27));
    later.finalsDb.frozenStore.set(26, dbs.finalsDb.frozenStore.get(26));
    isRoundComplete.mockClear();

    const bracket = await computeBracket(later.seasonDb, later.finalsDb, YEAR);

    expect(weekFor(bracket, 27).eliminated).toEqual([6, 5]);
    expect(weekFor(bracket, 28).aliveAtStart).toEqual([1, 2, 3, 4]);
    expect(bracket.cumulativeLadder.find((e) => e.userId === 1).weeklyTotals['27']).toBe(99);
    // Decided weeks aren't asked about again.
    expect(isRoundComplete.mock.calls.map(([round]) => round)).toEqual([28, 29]);
  });

  test('Refresh re-derives a frozen week from live inputs', async () => {
    const dbs = makeDbs({ roundsWithStats: [26, 27, 28] });
    await computeBracket(dbs.seasonDb, dbs.finalsDb, YEAR);

    const later = makeDbs({ roundsWithStats: [26, 28] });
    later.finalsDb.frozenStore.set(27, dbs.finalsDb.frozenStore.get(27));
    later.finalsDb.frozenStore.set(26, dbs.finalsDb.frozenStore.get(26));

    const bracket = await computeBracket(later.seasonDb, later.finalsDb, YEAR, { recompute: true });

    expect(weekFor(bracket, 27).eliminated).toBeNull(); // no stats now, so not decided
    expect(weekFor(bracket, 28).aliveAtStart).toBeNull();
  });
});

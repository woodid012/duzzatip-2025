import { updateGameResults } from '../src/app/lib/refreshGameResults';
import { connectToDatabase } from '../src/app/lib/mongodb';
import { CURRENT_YEAR } from '../src/app/lib/constants';

jest.mock('../src/app/lib/mongodb', () => ({ connectToDatabase: jest.fn() }));

const ROUND = 27;

const row = (playerName, teamName, matchNumber) => ({
  player_name: playerName,
  team_name: teamName,
  match_number: matchNumber,
  round: ROUND,
  year: CURRENT_YEAR,
  disposals: 20,
});

let calls;
let stored;

function mockCollection() {
  return {
    collectionName: `${CURRENT_YEAR}_game_results`,
    createIndex: jest.fn().mockResolvedValue(undefined),
    countDocuments: jest.fn(async () => stored),
    bulkWrite: jest.fn(async (ops) => {
      calls.push({ op: 'bulkWrite', count: ops.length, ops });
      return { upsertedCount: ops.length, matchedCount: 0, modifiedCount: 0 };
    }),
    deleteMany: jest.fn(async (filter) => {
      calls.push({ op: 'deleteMany', filter });
      return { deletedCount: 0 };
    }),
  };
}

let collection;

beforeEach(() => {
  calls = [];
  stored = 0;
  collection = mockCollection();
  connectToDatabase.mockResolvedValue({ db: { collection: () => collection } });
});

// The bug this covers: the refresh used to delete a round's rows and insert the
// replacements after, so a read landing in between saw a round with no stats.
// In the Duzza Finals that scored every team zero, which the weekly cut read as
// a tie and spared the whole field — Preliminary Finals week showed 6 teams
// instead of 4 until the next poll.
describe('updateGameResults leaves no window where the round has no stats', () => {
  test('full replace writes the new rows before pruning anything', async () => {
    await updateGameResults([row('Nick Daicos', 'Collingwood', 1), row('Tom Stewart', 'Geelong Cats', 1)], ROUND);

    expect(calls.map((c) => c.op)).toEqual(['bulkWrite', 'deleteMany']);
  });

  test('every incoming row is upserted on its natural key', async () => {
    await updateGameResults([row('Nick Daicos', 'Collingwood', 1)], ROUND);

    const { ops } = calls.find((c) => c.op === 'bulkWrite');
    expect(ops[0].replaceOne.upsert).toBe(true);
    expect(ops[0].replaceOne.filter).toEqual({
      year: CURRENT_YEAR,
      round: ROUND,
      player_name: 'Nick Daicos',
      match_number: 1,
    });
  });

  test('the prune only removes rows this pass did not write', async () => {
    await updateGameResults([row('Nick Daicos', 'Collingwood', 1)], ROUND);

    const { ops } = calls.find((c) => c.op === 'bulkWrite');
    const batch = ops[0].replaceOne.replacement.refreshBatch;
    expect(typeof batch).toBe('string');

    const { filter } = calls.find((c) => c.op === 'deleteMany');
    expect(filter.round).toBe(ROUND);
    expect(filter.year).toBe(CURRENT_YEAR);
    expect(filter.refreshBatch).toEqual({ $ne: batch });
  });

  test('the prune spares rows a concurrent, fresher pass wrote', async () => {
    await updateGameResults([row('Nick Daicos', 'Collingwood', 1)], ROUND);

    const { filter } = calls.find((c) => c.op === 'deleteMany');
    const [older, legacy] = filter.$or;
    expect(older.created_at.$lt).toBeInstanceOf(Date);
    expect(legacy).toEqual({ created_at: { $exists: false } });
  });

  test('merge mode scopes both the write and the prune to the teams refreshed', async () => {
    await updateGameResults([row('Nick Daicos', 'Collingwood', 1)], ROUND, { merge: true });

    const { filter } = calls.find((c) => c.op === 'deleteMany');
    expect(filter.team_name).toEqual({ $in: ['Collingwood'] });
    expect(calls.map((c) => c.op)).toEqual(['bulkWrite', 'deleteMany']);
  });

  test('a suspect shrink still writes nothing at all', async () => {
    stored = 90; // a full round's worth already there — one row back is degraded

    const result = await updateGameResults([row('Nick Daicos', 'Collingwood', 1)], ROUND);

    expect(result.skipped).toBe(true);
    expect(calls).toEqual([]);
  });

  test('a concurrent duplicate-key race is tolerated, not thrown', async () => {
    collection.bulkWrite.mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key'), {
        writeErrors: [{ code: 11000 }],
        result: { upsertedCount: 0, matchedCount: 1 },
      })
    );

    await expect(
      updateGameResults([row('Nick Daicos', 'Collingwood', 1)], ROUND)
    ).resolves.toEqual({ insertedCount: 1 });
  });
});

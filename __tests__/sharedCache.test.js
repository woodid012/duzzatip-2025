import { claimStamp, getShared, setShared, withShared } from '../src/app/lib/sharedCache';
import { connectToDatabase } from '../src/app/lib/mongodb';

jest.mock('../src/app/lib/mongodb', () => ({ connectToDatabase: jest.fn() }));

let docs;
let collection;

beforeEach(() => {
  docs = new Map();
  collection = {
    createIndex: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(async ({ _id }) => docs.get(_id) ?? null),
    updateOne: jest.fn(async ({ _id }, { $set }) => {
      docs.set(_id, { _id, ...$set });
      return { acknowledged: true };
    }),
  };
  connectToDatabase.mockResolvedValue({ db: { collection: () => collection } });
});

test('a value written by one caller is readable by the next', async () => {
  await setShared('round-complete:2026:27', true, 60_000);

  await expect(getShared('round-complete:2026:27')).resolves.toBe(true);
});

test('false is a value, not a miss', async () => {
  await setShared('round-complete:2026:28', false, 60_000);

  await expect(getShared('round-complete:2026:28')).resolves.toBe(false);
});

test('an unwritten key misses', async () => {
  await expect(getShared('nothing-here')).resolves.toBeUndefined();
});

test('an expired value misses, so the caller recomputes', async () => {
  await setShared('stale', 'old', -1);

  await expect(getShared('stale')).resolves.toBeUndefined();
});

test('a database that is down is a miss, never an error', async () => {
  collection.findOne.mockRejectedValue(new Error('no connection'));
  collection.updateOne.mockRejectedValue(new Error('no connection'));

  await expect(getShared('anything')).resolves.toBeUndefined();
  await expect(setShared('anything', 1, 1000)).resolves.toBeUndefined();
});

describe('withShared', () => {
  test('computes on a miss and shares the result', async () => {
    const compute = jest.fn().mockResolvedValue({ weeks: 4 });

    await expect(withShared('bracket', 20_000, compute)).resolves.toEqual({ weeks: 4 });
    await expect(withShared('bracket', 20_000, compute)).resolves.toEqual({ weeks: 4 });
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

describe('claimStamp', () => {
  test('the first caller claims the work and the rest stand down', async () => {
    await expect(claimStamp('afl-overlay:2026', 60_000)).resolves.toBe(true);
    await expect(claimStamp('afl-overlay:2026', 60_000)).resolves.toBe(false);
  });

  test('the claim lapses once its window passes', async () => {
    await claimStamp('afl-overlay:2026', -1);

    await expect(claimStamp('afl-overlay:2026', 60_000)).resolves.toBe(true);
  });
});

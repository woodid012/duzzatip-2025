/**
 * The snapshot store is what keeps a page from showing a skeleton over data it
 * already has, so the contract that matters is: a write is readable back, a
 * miss is undefined, and nothing here can throw into a render.
 */
let readSnapshot;
let writeSnapshot;

function fakeSessionStorage() {
  const store = new Map();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

let sessionStore;

beforeEach(() => {
  jest.resetModules();
  sessionStore = fakeSessionStorage();
  global.window = { sessionStorage: sessionStore };
  ({ readSnapshot, writeSnapshot } = require('../src/app/lib/clientSnapshot'));
});

afterEach(() => {
  delete global.window;
});

test('a written payload reads back', () => {
  writeSnapshot('bracket', { weeks: 4 });

  expect(readSnapshot('bracket')).toEqual({ weeks: 4 });
});

test('an unwritten key is a miss', () => {
  expect(readSnapshot('never-written')).toBeUndefined();
});

test('a payload survives a fresh module load, the way a reload sees it', () => {
  writeSnapshot('bracket', { weeks: 4 });

  jest.resetModules();
  const reloaded = require('../src/app/lib/clientSnapshot');

  expect(reloaded.readSnapshot('bracket')).toEqual({ weeks: 4 });
});

test('maxAgeMs treats an old payload as a miss', () => {
  writeSnapshot('fixtures', [{ MatchNumber: 1 }]);

  expect(readSnapshot('fixtures', { maxAgeMs: -1 })).toBeUndefined();
  expect(readSnapshot('fixtures', { maxAgeMs: 60_000 })).toEqual([{ MatchNumber: 1 }]);
});

test('session: false keeps a viewer-filtered payload out of storage', () => {
  writeSnapshot('round-results:2026:28', { roundData: { mine: true } }, { session: false });

  expect(readSnapshot('round-results:2026:28')).toEqual({ roundData: { mine: true } });
  expect([...sessionStore.store.keys()]).toEqual([]);

  // Gone once the module is reloaded, as a page reload would.
  jest.resetModules();
  expect(require('../src/app/lib/clientSnapshot').readSnapshot('round-results:2026:28')).toBeUndefined();
});

test('storage that throws is survivable — a blocked or full store is just a miss', () => {
  global.window.sessionStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota'); },
  };

  expect(() => writeSnapshot('bracket', { weeks: 4 })).not.toThrow();
  expect(readSnapshot('bracket')).toEqual({ weeks: 4 }); // memory still serves it

  jest.resetModules();
  const reloaded = require('../src/app/lib/clientSnapshot');
  expect(reloaded.readSnapshot('bracket')).toBeUndefined();
});

test('server-side rendering has no storage and no crash', () => {
  delete global.window;

  expect(() => writeSnapshot('bracket', { weeks: 4 })).not.toThrow();
  expect(readSnapshot('bracket')).toEqual({ weeks: 4 });
});

test('a corrupt stored entry is a miss, not a throw', () => {
  sessionStore.setItem('dz:snap:bracket', '{not json');

  expect(readSnapshot('bracket')).toBeUndefined();
});

// The finals fixture sync is the path a finals score lands by, and the week's
// dead certs and the next week's matchup wait on it — so a pull that fails
// must be retried promptly, not sat out for the whole interval.
function load() {
  jest.resetModules();
  const claimStamp = jest.fn();
  jest.doMock('../src/app/lib/sharedCache', () => ({ claimStamp }));
  const { syncFinalsFixtures } = require('../src/app/lib/duzzaFinalsFixtures');
  return { syncFinalsFixtures, claimStamp };
}

beforeEach(() => {
  // The AFL token handshake is the first thing a pull does; failing it fails the pull.
  global.fetch = jest.fn().mockRejectedValue(new Error('AFL down'));
});
afterEach(() => { delete global.fetch; });

test('the cross-instance claim is held for far less than the instance interval', async () => {
  const { syncFinalsFixtures, claimStamp } = load();
  claimStamp.mockResolvedValue(true);

  await syncFinalsFixtures({}, 2026);

  const [, ttl] = claimStamp.mock.calls[0];
  expect(ttl).toBeLessThanOrEqual(2 * 60 * 1000);
});

test('losing the claim does not spend this instance\'s interval', async () => {
  const { syncFinalsFixtures, claimStamp } = load();
  claimStamp.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

  await syncFinalsFixtures({}, 2026);
  await syncFinalsFixtures({}, 2026);

  expect(claimStamp).toHaveBeenCalledTimes(2);
  expect(global.fetch).toHaveBeenCalledTimes(1); // the second call got the claim and pulled
});

test('a failed pull is retried on the very next request', async () => {
  const { syncFinalsFixtures, claimStamp } = load();
  claimStamp.mockResolvedValue(true);

  await syncFinalsFixtures({}, 2026);
  await syncFinalsFixtures({}, 2026);

  expect(global.fetch).toHaveBeenCalledTimes(2);
});

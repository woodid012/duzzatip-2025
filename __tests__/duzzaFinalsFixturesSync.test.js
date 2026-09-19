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

// What the sync writes. It re-pulls every finals round on every pass, so a
// score it has already stored must survive a response that doesn't carry one.
describe('what a sync pass writes', () => {
  const match = (home, away, { scores = null, status = 'CONCLUDED' } = {}) => ({
    status,
    utcStartTime: '2026-09-11T10:10:00.000Z',
    home: { team: { club: { name: home } } },
    away: { team: { club: { name: away } } },
    ...(scores
      ? {
          homeTeamScore: { matchScore: { totalScore: scores[0] } },
          awayTeamScore: { matchScore: { totalScore: scores[1] } },
        }
      : {}),
  });

  // Round 27 only; every other finals round comes back empty.
  function aflFeed(round27Matches) {
    return jest.fn(async (url) => {
      if (String(url).includes('WMCTok')) return { ok: true, json: async () => ({ token: 't' }) };
      const round = Number(new URL(url).searchParams.get('roundNumber'));
      return { ok: true, json: async () => ({ matches: round === 27 ? round27Matches : [] }) };
    });
  }

  function seasonDb(existingRows) {
    const writes = [];
    return {
      writes,
      collection: () => ({
        find: () => ({ toArray: async () => existingRows }),
        bulkWrite: async (ops) => { writes.push(...ops); return {}; },
      }),
    };
  }

  const stored = [{ HomeTeam: 'Fremantle', AwayTeam: 'Geelong Cats' }];

  test('a match that carries a score writes it', async () => {
    const { syncFinalsFixtures, claimStamp } = load();
    claimStamp.mockResolvedValue(true);
    global.fetch = aflFeed([match('Fremantle', 'Geelong Cats', { scores: [120, 98] })]);
    const db = seasonDb(stored);

    await syncFinalsFixtures(db, 2026);

    const [op] = db.writes;
    expect(op.updateOne.update.$set).toMatchObject({ HomeTeamScore: 120, AwayTeamScore: 98 });
  });

  test('a decided game whose response has no score keeps the stored one', async () => {
    const { syncFinalsFixtures, claimStamp } = load();
    claimStamp.mockResolvedValue(true);
    global.fetch = aflFeed([match('Fremantle', 'Geelong Cats')]); // CONCLUDED, no score field
    const db = seasonDb(stored);

    await syncFinalsFixtures(db, 2026);

    const [op] = db.writes;
    expect(op.updateOne.update.$set).not.toHaveProperty('HomeTeamScore');
    expect(op.updateOne.update.$set).not.toHaveProperty('AwayTeamScore');
    expect(op.updateOne.update.$set).toHaveProperty('DateUtc'); // the date still syncs
  });

  test('a live game is stored without a score, not with a wiped one', async () => {
    const { syncFinalsFixtures, claimStamp } = load();
    claimStamp.mockResolvedValue(true);
    global.fetch = aflFeed([match('Hawthorn', 'Brisbane Lions', { status: 'LIVE' })]);
    const db = seasonDb(stored);

    await syncFinalsFixtures(db, 2026);

    const [op] = db.writes;
    expect(op.updateOne.update.$set).not.toHaveProperty('HomeTeamScore');
    expect(op.updateOne.update.$setOnInsert).toMatchObject({ HomeTeamScore: null, AwayTeamScore: null, MatchNumber: 2702 });
  });
});

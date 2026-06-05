const {
  bestGameScore, getLastCompletedRound, getEffectiveRound,
  loadTradeEvents, evaluateTradeEvents, buildTradeMessage,
} = require('../lockout-notify.js');

// Minimal fixtures: 3 rounds, all far in the past so "completed" is deterministic.
const fixtures = [
  { RoundNumber: 1, DateUtc: '2020-03-01T08:00:00Z' },
  { RoundNumber: 1, DateUtc: '2020-03-02T08:00:00Z' },
  { RoundNumber: 2, DateUtc: '2020-03-08T08:00:00Z' },
  { RoundNumber: 2, DateUtc: '2020-03-09T08:00:00Z' },
  { RoundNumber: 3, DateUtc: '2020-03-15T08:00:00Z' },
  { RoundNumber: 3, DateUtc: '2020-03-16T08:00:00Z' },
];

const mid = (k, h) => ({ kicks: k, handballs: h, marks: 0, tackles: 0, hitouts: 0, goals: 0, behinds: 0 });

// One swap (Draper for Fogarty) between user 4 and user 7, logged by BOTH users
// — exactly how the app's PATCH writes it. Must collapse to a single event.
const tradeDate = '2020-03-04T00:00:00Z'; // between R1 and R2 -> effective R2
const rawTx = [
  { type: 'trade', Active: 1, user_id: 4, trade_with_user_id: 7,
    players_in: ['Sam Draper'], players_out: ['Darcy Fogarty'], transaction_date: tradeDate },
  { type: 'trade', Active: 1, user_id: 7, trade_with_user_id: 4,
    players_in: ['Darcy Fogarty'], players_out: ['Sam Draper'], transaction_date: tradeDate },
];

const gameResults = [
  { player_name: 'Sam Draper', round: 2, ...mid(20, 10) },   // best (MID) = 30
  { player_name: 'Sam Draper', round: 3, ...mid(20, 10) },   // 30
  { player_name: 'Darcy Fogarty', round: 2, ...mid(5, 5) },  // 10  (misses R3)
];

function mockDb() {
  return {
    collection(name) {
      const data = name.endsWith('squad_transactions') ? rawTx
                 : name.endsWith('game_results') ? gameResults : [];
      const cur = {
        _q: {},
        find(q) { this._q = q || {}; return this; },
        sort() { return this; },
        async toArray() {
          let d = data;
          const q = this._q;
          if (q.type) d = d.filter(x => x.type === q.type);
          if (q.player_name && q.player_name.$in) d = d.filter(x => q.player_name.$in.includes(x.player_name));
          if (q.round) d = d.filter(x => (q.round.$gte == null || x.round >= q.round.$gte) && (q.round.$lte == null || x.round <= q.round.$lte));
          return d;
        },
      };
      return cur;
    },
  };
}

describe('bestGameScore', () => {
  test('takes the highest-scoring position for the game', () => {
    expect(bestGameScore(mid(20, 10))).toBe(30);          // MID
    expect(bestGameScore({ goals: 4, behinds: 0, kicks: 0, handballs: 0, marks: 0, tackles: 0, hitouts: 0 })).toBe(36); // FF
  });
});

describe('round mapping', () => {
  test('getLastCompletedRound returns last fully-started round', () => {
    expect(getLastCompletedRound(fixtures)).toBe(3);
  });
  test('getEffectiveRound is the next round to start after the trade', () => {
    expect(getEffectiveRound(fixtures, '2020-03-04T00:00:00Z')).toBe(2);
    expect(getEffectiveRound(fixtures, '2020-02-01T00:00:00Z')).toBe(1);
  });
});

describe('trade events', () => {
  test('mirrored per-user records collapse into one event', async () => {
    const events = await loadTradeEvents(mockDb(), fixtures);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.userLow).toBe(4);
    expect(ev.userHigh).toBe(7);
    expect(ev.lowReceives).toEqual(['Sam Draper']);
    expect(ev.highReceives).toEqual(['Darcy Fogarty']);
    expect(ev.roundEff).toBe(2);
  });

  test('evaluation totals points and tracks games played/missed', async () => {
    const events = await loadTradeEvents(mockDb(), fixtures);
    const [rep] = await evaluateTradeEvents(mockDb(), fixtures, events, 3);
    expect(rep.lowPts).toBe(60);  // Draper 30 + 30
    expect(rep.highPts).toBe(10); // Fogarty 10
    expect(rep.low[0]).toMatchObject({ name: 'Sam Draper', pts: 60, played: 2, missed: 0 });
    expect(rep.high[0]).toMatchObject({ name: 'Darcy Fogarty', pts: 10, played: 1, missed: 1 });
    expect(rep.winner).toBe(4);
    expect(rep.diff).toBe(50);
  });

  test('message renders winner, points and games missed', async () => {
    const events = await loadTradeEvents(mockDb(), fixtures);
    const reports = await evaluateTradeEvents(mockDb(), fixtures, events, 3);
    const msg = buildTradeMessage(reports, 3);
    expect(msg).toContain('Sam Draper — *60* _(2g, 0m)_');
    expect(msg).toContain('Darcy Fogarty — *10* _(1g, 1m)_');
    expect(msg).toMatch(/winning by 50/);
  });
});

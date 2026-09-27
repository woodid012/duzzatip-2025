const { AFL_COMP_SEASON_ID, getAFLToken, aflMatchesUrl } = require('../src/app/lib/lockoutShared');

afterEach(() => { delete global.fetch; });

describe('getAFLToken', () => {
  test('POSTs to WMCTok and returns the token', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'abc' }) });
    await expect(getAFLToken()).resolves.toBe('abc');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.afl.com.au/cfs/afl/WMCTok');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Origin).toBe('https://www.afl.com.au');
    expect(opts.signal).toBeDefined();
  });

  test('throws on non-2xx so callers decide how to fail', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(getAFLToken()).rejects.toThrow('AFL token HTTP 503');
  });

  test('propagates network errors', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('AFL down'));
    await expect(getAFLToken(3000)).rejects.toThrow('AFL down');
  });
});

describe('aflMatchesUrl', () => {
  test('carries the comp season id, round and page size', () => {
    const url = new URL(aflMatchesUrl(7, 30));
    expect(url.pathname).toBe('/afl/v2/matches');
    expect(url.searchParams.get('competitionId')).toBe('1');
    expect(url.searchParams.get('compSeasonId')).toBe(String(AFL_COMP_SEASON_ID));
    expect(url.searchParams.get('roundNumber')).toBe('7');
    expect(url.searchParams.get('pageSize')).toBe('30');
  });

  test('defaults pageSize to 20', () => {
    expect(new URL(aflMatchesUrl(0)).searchParams.get('pageSize')).toBe('20');
  });
});

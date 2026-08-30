import {
  DUZZA_FINALS_ROUNDS,
  isDuzzaFinalsRound,
  getFinalsCurrentRound,
  deriveFinalsCandidatePlayers,
  pruneFinalsCandidates,
  buildFinalsTeamDoc,
  buildFinalsTipsDoc,
} from '../src/app/lib/duzzaFinalsAutoPick';

describe('isDuzzaFinalsRound', () => {
  test('true for 26-29, false otherwise', () => {
    for (const r of DUZZA_FINALS_ROUNDS) expect(isDuzzaFinalsRound(r)).toBe(true);
    expect(isDuzzaFinalsRound(24)).toBe(false);
    expect(isDuzzaFinalsRound(25)).toBe(false);
    expect(isDuzzaFinalsRound('26')).toBe(true);
  });
});

describe('getFinalsCurrentRound', () => {
  test('null when nothing synced at all', () => {
    expect(getFinalsCurrentRound([])).toBeNull();
    expect(getFinalsCurrentRound(null)).toBeNull();
  });

  test('picks the earliest round with an upcoming fixture', () => {
    const future1 = new Date(Date.now() + 3600_000).toISOString();
    const future2 = new Date(Date.now() + 7200_000).toISOString();
    const past = new Date(Date.now() - 3600_000).toISOString();
    const fixtures = [
      { RoundNumber: 26, DateUtc: past },
      { RoundNumber: 27, DateUtc: future1 },
      { RoundNumber: 27, DateUtc: future2 },
    ];
    expect(getFinalsCurrentRound(fixtures)).toBe(27);
  });

  test('falls back to the latest known round once everything synced has passed', () => {
    const past1 = new Date(Date.now() - 7200_000).toISOString();
    const past2 = new Date(Date.now() - 3600_000).toISOString();
    const fixtures = [
      { RoundNumber: 26, DateUtc: past1 },
      { RoundNumber: 27, DateUtc: past2 },
    ];
    expect(getFinalsCurrentRound(fixtures)).toBe(27);
  });

  test('ignores rounds outside the supplied roundsList', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const fixtures = [{ RoundNumber: 25, DateUtc: future }];
    expect(getFinalsCurrentRound(fixtures)).toBeNull();
  });
});

describe('deriveFinalsCandidatePlayers', () => {
  test('keeps only players whose club is in the round fixtures', () => {
    const players = [
      { player_name: 'A Player', team_name: 'ADE' },
      { player_name: 'B Player', team_name: 'CAR' },
      { player_name: 'C Player', team_name: 'GEE' },
    ];
    const roundFixtures = [{ HomeTeam: 'Adelaide Crows', AwayTeam: 'Carlton' }];
    const result = deriveFinalsCandidatePlayers(players, roundFixtures);
    expect(result).toEqual([
      { name: 'A Player', team: 'ADE' },
      { name: 'B Player', team: 'CAR' },
    ]);
  });

  test('empty roundFixtures yields no candidates', () => {
    const players = [{ player_name: 'A Player', team_name: 'ADE' }];
    expect(deriveFinalsCandidatePlayers(players, [])).toEqual([]);
  });

  test('a placeholder fixture team name (not a real club) contributes no eligible club', () => {
    const players = [{ player_name: 'A Player', team_name: 'ADE' }];
    const roundFixtures = [{ HomeTeam: 'Winner of QF1', AwayTeam: 'Winner of QF2' }];
    expect(deriveFinalsCandidatePlayers(players, roundFixtures)).toEqual([]);
  });
});

describe('pruneFinalsCandidates', () => {
  const positions = ['Full Forward', 'Midfielder'];

  test('keeps the top N per position, unioned across positions', () => {
    const pool = [
      { name: 'FF1', scores: { 'Full Forward': 100 } },
      { name: 'FF2', scores: { 'Full Forward': 90 } },
      { name: 'FF3', scores: { 'Full Forward': 10 } },
      { name: 'MID1', scores: { Midfielder: 80 } },
    ];
    const result = pruneFinalsCandidates(pool, { positions, topN: 2 });
    const names = new Set(result.map(p => p.name));
    expect(names).toEqual(new Set(['FF1', 'FF2', 'MID1']));
    expect(names.has('FF3')).toBe(false);
  });

  test('a dual-position star is only counted once', () => {
    const pool = [
      { name: 'Star', scores: { 'Full Forward': 100, Midfielder: 95 } },
      { name: 'Other', scores: { 'Full Forward': 50 } },
    ];
    const result = pruneFinalsCandidates(pool, { positions, topN: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Star');
  });

  test('keepNames survives pruning even with a low score', () => {
    const pool = [
      { name: 'FF1', scores: { 'Full Forward': 100 } },
      { name: 'FF2', scores: { 'Full Forward': 90 } },
      { name: 'Kept', scores: { 'Full Forward': 1 } },
    ];
    const result = pruneFinalsCandidates(pool, { positions: ['Full Forward'], topN: 2, keepNames: new Set(['Kept']) });
    expect(result.map(p => p.name).sort()).toEqual(['FF1', 'FF2', 'Kept']);
  });

  test('players with no score at a position are excluded from that position\'s ranking', () => {
    const pool = [
      { name: 'A', scores: {} },
      { name: 'B', scores: { 'Full Forward': 5 } },
    ];
    const result = pruneFinalsCandidates(pool, { positions: ['Full Forward'], topN: 5 });
    expect(result.map(p => p.name)).toEqual(['B']);
  });
});

describe('buildFinalsTeamDoc', () => {
  const positions = ['Full Forward', 'Midfielder'];

  test('maps a full result into the entry Team doc shape', () => {
    const result = {
      lineup: {
        'Full Forward': { name: 'A Player', team: 'ADE' },
        Midfielder: { name: 'B Player', team: 'CAR' },
      },
      bench: { name: 'C Player', team: 'GEE' },
      benchBackup: 'Midfielder',
      reserveA: { name: 'D Player', team: 'RIC' },
      reserveB: { name: 'E Player', team: 'HAW' },
    };
    expect(buildFinalsTeamDoc(result, positions)).toEqual({
      'Full Forward': { player: 'A Player', club: 'ADE' },
      Midfielder: { player: 'B Player', club: 'CAR' },
      Bench: { player: 'C Player', club: 'GEE', backup_position: 'Midfielder' },
      'Reserve A': { player: 'D Player', club: 'RIC' },
      'Reserve B': { player: 'E Player', club: 'HAW' },
    });
  });

  test('omits slots the optimiser left empty', () => {
    const result = { lineup: { 'Full Forward': { name: 'A Player', team: 'ADE' } }, bench: null, reserveA: null, reserveB: null };
    expect(buildFinalsTeamDoc(result, positions)).toEqual({
      'Full Forward': { player: 'A Player', club: 'ADE' },
    });
  });
});

describe('buildFinalsTipsDoc', () => {
  test('maps tips-by-match-number into the entry Tips array shape', () => {
    const roundFixtures = [{ MatchNumber: 2601, HomeTeam: 'Adelaide Crows', AwayTeam: 'Carlton' }];
    const tips = { 2601: { team: 'Adelaide Crows', deadCert: false } };
    expect(buildFinalsTipsDoc(tips, roundFixtures)).toEqual([
      { MatchNumber: 2601, Match: 'Adelaide Crows v Carlton', Tip: 'Adelaide Crows', DeadCert: false },
    ]);
  });

  test('DeadCert reflects whatever the caller passed in (auto-fill callers must force false themselves)', () => {
    const roundFixtures = [{ MatchNumber: 2601, HomeTeam: 'Adelaide Crows', AwayTeam: 'Carlton' }];
    const tips = { 2601: { team: 'Adelaide Crows', deadCert: true } };
    expect(buildFinalsTipsDoc(tips, roundFixtures)[0].DeadCert).toBe(true);
  });

  test('missing fixture yields a null Match label rather than throwing', () => {
    const tips = { 9999: { team: 'Nobody', deadCert: false } };
    expect(buildFinalsTipsDoc(tips, [])).toEqual([
      { MatchNumber: 9999, Match: null, Tip: 'Nobody', DeadCert: false },
    ]);
  });
});

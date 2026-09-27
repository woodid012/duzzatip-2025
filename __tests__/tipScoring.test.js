import { isMatchComplete, matchWinner, scoreTip, totalTips } from '../src/app/lib/tipScoring';

const fixture = (home, away, extra = {}) => ({
  MatchNumber: 1,
  HomeTeam: 'Cats',
  AwayTeam: 'Swans',
  HomeTeamScore: home,
  AwayTeamScore: away,
  ...extra,
});

// ─── scoreTip ───────────────────────────────────────────────────────────────

describe('scoreTip', () => {
  test('correct tip', () => {
    const result = scoreTip(fixture(90, 60), { Team: 'Cats', DeadCert: false });
    expect(result.correct).toBe(true);
    expect(result.isCompleted).toBe(true);
    expect(result.isDefault).toBe(false);
  });

  test('incorrect tip', () => {
    expect(scoreTip(fixture(90, 60), { Team: 'Swans' }).correct).toBe(false);
  });

  test('a Draw is never a correct tip', () => {
    const f = fixture(70, 70);
    expect(matchWinner(f)).toBe('Draw');
    expect(scoreTip(f, { Team: 'Cats' }).correct).toBe(false);
    expect(scoreTip(f, { Team: 'Swans' }).correct).toBe(false);
    expect(scoreTip(f, undefined).correct).toBe(false);
  });

  test('missing tip defaults to the home team, never a dead cert', () => {
    const result = scoreTip(fixture(90, 60), undefined);
    expect(result.tip).toBe('Cats');
    expect(result.isDefault).toBe(true);
    expect(result.deadCert).toBe(false);
    expect(result.correct).toBe(true);
    expect(scoreTip(fixture(60, 90), undefined).correct).toBe(false);
  });

  test('incomplete match is unscored', () => {
    const f = fixture(null, null);
    expect(isMatchComplete(f)).toBe(false);
    const result = scoreTip(f, { Team: 'Cats', DeadCert: true });
    expect(result.isCompleted).toBe(false);
    expect(result.correct).toBeNull();
    expect(totalTips([result])).toEqual({ correctTips: 0, deadCertScore: 0, correctDeadCerts: 0, wrongDeadCerts: 0 });
  });

  test('returns the display row shape', () => {
    expect(scoreTip(fixture(90, 60), { Team: 'Swans', DeadCert: true })).toEqual({
      matchNumber: 1,
      homeTeam: 'Cats',
      awayTeam: 'Swans',
      homeScore: 90,
      awayScore: 60,
      tip: 'Swans',
      deadCert: true,
      correct: false,
      isDefault: false,
      isCompleted: true,
    });
  });
});

// ─── totalTips ──────────────────────────────────────────────────────────────

describe('totalTips', () => {
  test('dead cert +6 if correct, -12 if wrong; plain tips add 0', () => {
    const result = totalTips([
      scoreTip(fixture(90, 60), { Team: 'Cats', DeadCert: true }),  // +6
      scoreTip(fixture(90, 60), { Team: 'Swans', DeadCert: true }), // -12
      scoreTip(fixture(90, 60), { Team: 'Cats' }),                  // 0, correct
      scoreTip(fixture(90, 60), { Team: 'Swans' }),                 // 0
    ]);
    expect(result).toEqual({ correctTips: 2, deadCertScore: 6 - 12, correctDeadCerts: 1, wrongDeadCerts: 1 });
  });

  test('a dead cert on a Draw costs -12', () => {
    expect(totalTips([scoreTip(fixture(70, 70), { Team: 'Cats', DeadCert: true })]).deadCertScore).toBe(-12);
  });

  test('no matches → zero everything', () => {
    expect(totalTips([])).toEqual({ correctTips: 0, deadCertScore: 0, correctDeadCerts: 0, wrongDeadCerts: 0 });
  });

  test('all correct dead certs stack', () => {
    const matches = [
      { correct: true, deadCert: true },
      { correct: true, deadCert: true },
      { correct: true, deadCert: true },
    ];
    expect(totalTips(matches).correctTips).toBe(3);
    expect(totalTips(matches).deadCertScore).toBe(18);
  });
});

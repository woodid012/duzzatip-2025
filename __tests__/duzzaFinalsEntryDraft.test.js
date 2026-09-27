import {
  tipsArrayToMap,
  draftTipsMap,
  selectTip,
  toggleDeadCert,
  setBenchBackup,
  buildCleanedTeam,
  buildTipsArray,
  buildEntryPayload,
  defaultWeekFromCurrent,
  canEditEntry,
} from '../src/app/lib/duzzaFinalsEntryDraft';

const weekFixtures = [
  { MatchNumber: 1, HomeTeam: 'Geelong Cats', AwayTeam: 'Hawthorn' },
  { MatchNumber: 2, HomeTeam: 'Collingwood', AwayTeam: 'Carlton' },
];

describe('tips map ⇄ array', () => {
  test('parses a saved Tips array, skipping rows without a MatchNumber', () => {
    expect(tipsArrayToMap([
      { MatchNumber: 1, Tip: 'Hawthorn', DeadCert: 1 },
      { Tip: 'Carlton' },
      null,
    ])).toEqual({ 1: { team: 'Hawthorn', deadCert: true } });
    expect(tipsArrayToMap(undefined)).toEqual({});
  });

  test('core page draft fills untipped games with the home team, flagged isDefault', () => {
    const map = draftTipsMap([{ MatchNumber: 1, Tip: 'Hawthorn' }], weekFixtures, { homeTeamDefault: true });
    expect(map).toEqual({
      1: { team: 'Hawthorn', deadCert: false },
      2: { team: 'Collingwood', deadCert: false, isDefault: true },
    });
    // …and those defaults are saved as real tips.
    expect(buildTipsArray(weekFixtures, map).map((t) => t.Tip)).toEqual(['Hawthorn', 'Collingwood']);
  });

  test('/finals draft fills untipped games with a blank tip, which is not saved', () => {
    const map = draftTipsMap([], weekFixtures, { homeTeamDefault: false });
    expect(map[2]).toEqual({ team: '', deadCert: false });
    expect(buildTipsArray(weekFixtures, map)).toEqual([]);
  });

  test('changing a tip drops its dead cert; re-picking the same team keeps it', () => {
    const start = { 1: { team: 'Hawthorn', deadCert: true } };
    expect(selectTip(start, 1, 'Geelong Cats')[1]).toEqual({ team: 'Geelong Cats', deadCert: false, isDefault: false });
    expect(selectTip(start, 1, 'Hawthorn')[1].deadCert).toBe(true);
    expect(toggleDeadCert(start, 1)[1].deadCert).toBe(false);
  });
});

describe('draft → payload', () => {
  const team = {
    'Full Forward': { player: 'Jeremy Cameron', club: 'GEE', extra: 'x' },
    Midfielder: { player: 'Nick Daicos', club: null },
    Ruck: {},
    Bench: { player: 'Sam Walsh', club: 'CAR', backup_position: 'Midfielder' },
  };

  test('keeps only fully-filled slots, and the backup position on Bench', () => {
    expect(buildCleanedTeam(team)).toEqual({
      'Full Forward': { player: 'Jeremy Cameron', club: 'GEE' },
      Bench: { player: 'Sam Walsh', club: 'CAR', backup_position: 'Midfielder' },
    });
  });

  test('setBenchBackup changes only the Bench backup position', () => {
    expect(setBenchBackup({}, 'Ruck')).toEqual({ Bench: { backup_position: 'Ruck' } });
  });

  test('combined save carries team, tips and year', () => {
    const payload = buildEntryPayload({
      round: 27, userId: 4, year: 2026, team, weekFixtures,
      tipsMap: { 1: { team: 'Hawthorn', deadCert: true }, 2: { team: '' } },
    });
    expect(payload).toEqual({
      round: 27,
      userId: 4,
      year: 2026,
      team: buildCleanedTeam(team),
      tips: [{ MatchNumber: 1, Match: 'Geelong Cats v Hawthorn', Tip: 'Hawthorn', DeadCert: true }],
    });
  });

  test('team-only and tips-only saves omit the other field; no year key when not given', () => {
    const teamOnly = buildEntryPayload({ round: 26, userId: 1, team });
    expect(Object.keys(teamOnly).sort()).toEqual(['round', 'team', 'userId']);
    const tipsOnly = buildEntryPayload({ round: 26, userId: 1, tipsMap: {}, weekFixtures });
    expect(tipsOnly).toEqual({ round: 26, userId: 1, tips: [] });
  });
});

describe('defaultWeekFromCurrent', () => {
  test('follows a finals currentWeek until the user picks a week', () => {
    expect(defaultWeekFromCurrent(28, { userChangedWeek: false, clampUnknown: false })).toBe(28);
    expect(defaultWeekFromCurrent(28, { userChangedWeek: true, clampUnknown: true })).toBeNull();
    expect(defaultWeekFromCurrent(null, { userChangedWeek: false, clampUnknown: true })).toBeNull();
  });

  test('an unknown currentWeek clamps to week 1 on the core page, and is ignored on /finals', () => {
    expect(defaultWeekFromCurrent(30, { userChangedWeek: false, clampUnknown: true })).toBe(26);
    expect(defaultWeekFromCurrent(30, { userChangedWeek: false, clampUnknown: false })).toBeNull();
  });
});

describe('canEditEntry', () => {
  const open = { hasEntrant: true, fixturesKnown: true, locked: false };

  test('needs an entrant, known fixtures and an unlocked week', () => {
    expect(canEditEntry(open)).toBe(true);
    expect(canEditEntry({ ...open, hasEntrant: false })).toBe(false);
    expect(canEditEntry({ ...open, fixturesKnown: false })).toBe(false);
    expect(canEditEntry({ ...open, locked: true })).toBe(false);
  });

  test('core page: an admin may edit a locked week, but never a past year', () => {
    expect(canEditEntry({ ...open, locked: true, isAdmin: true })).toBe(true);
    expect(canEditEntry({ ...open, isAdmin: true, isPastYear: true })).toBe(false);
  });

  test('/finals app: nothing is editable while auth is loading', () => {
    expect(canEditEntry({ ...open, authLoading: true })).toBe(false);
  });
});

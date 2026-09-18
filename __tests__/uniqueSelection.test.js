import {
  applyFinalsPick,
  duplicatesIntroduced,
  findDuplicateSelections,
  findPlayerPosition,
  positionsByPlayer,
  slotPlayerName,
} from '../src/app/lib/uniqueSelection';

// Season selections key the name as player_name; Duzza Finals entries use
// player. Both shapes go through the same helpers.
const seasonTeam = {
  _lastUpdated: '2026-04-10T00:00:00.000Z',
  'Full Forward': { player_name: 'Jeremy Cameron' },
  Midfielder: { player_name: 'Nick Daicos' },
  Bench: { player_name: '', backup_position: 'Ruck' },
};

const finalsTeam = {
  'Full Forward': { player: 'Jeremy Cameron', club: 'GEE' },
  Midfielder: { player: 'Nick Daicos', club: 'COL' },
};

describe('slotPlayerName', () => {
  test('reads either shape, and empties for a vacant slot', () => {
    expect(slotPlayerName({ player_name: 'Nick Daicos' })).toBe('Nick Daicos');
    expect(slotPlayerName({ player: 'Nick Daicos' })).toBe('Nick Daicos');
    expect(slotPlayerName({ player_name: '' })).toBe('');
    expect(slotPlayerName(null)).toBe('');
  });
});

describe('findPlayerPosition', () => {
  test('finds the position already holding the player', () => {
    expect(findPlayerPosition(seasonTeam, 'Nick Daicos')).toBe('Midfielder');
    expect(findPlayerPosition(finalsTeam, 'Nick Daicos')).toBe('Midfielder');
  });

  test('ignores the slot being filled, so re-picking in place is not a clash', () => {
    expect(findPlayerPosition(seasonTeam, 'Nick Daicos', 'Midfielder')).toBeNull();
  });

  test('no match for a player not in the team, or for an empty pick', () => {
    expect(findPlayerPosition(seasonTeam, 'Marcus Bontempelli')).toBeNull();
    expect(findPlayerPosition(seasonTeam, '')).toBeNull();
  });

  test('bookkeeping keys are never mistaken for a position', () => {
    expect(findPlayerPosition(seasonTeam, '2026-04-10T00:00:00.000Z')).toBeNull();
  });
});

describe('findDuplicateSelections', () => {
  test('a clean team has none', () => {
    expect(findDuplicateSelections(seasonTeam)).toEqual([]);
  });

  test('reports each player sitting in more than one position', () => {
    const team = {
      ...seasonTeam,
      Tackler: { player_name: 'Nick Daicos' },
      'Reserve B': { player_name: 'Nick Daicos' },
    };
    expect(findDuplicateSelections(team)).toEqual([
      { playerName: 'Nick Daicos', positions: ['Midfielder', 'Tackler', 'Reserve B'] },
    ]);
  });

  test('empty slots never collide with each other', () => {
    const team = {
      Bench: { player_name: '' },
      'Reserve A': { player_name: '' },
      'Reserve B': {},
    };
    expect(findDuplicateSelections(team)).toEqual([]);
  });
});

describe('duplicatesIntroduced', () => {
  const stored = {
    'Full Forward': { player_name: 'Jeremy Cameron' },
    Midfielder: { player_name: 'Nick Daicos' },
  };

  test('flags an incoming pick that lands on a player already in the team', () => {
    expect(duplicatesIntroduced(stored, { Tackler: { player_name: 'Nick Daicos' } })).toEqual([
      { playerName: 'Nick Daicos', positions: ['Midfielder', 'Tackler'] },
    ]);
  });

  test('a swap sent as both halves is clean', () => {
    const swap = {
      Midfielder: { player_name: 'Jeremy Cameron' },
      'Full Forward': { player_name: 'Nick Daicos' },
    };
    expect(duplicatesIntroduced(stored, swap)).toEqual([]);
  });

  test('half a swap — the other half refused by the lockout — is caught', () => {
    expect(duplicatesIntroduced(stored, { 'Full Forward': { player_name: 'Nick Daicos' } })).toEqual([
      { playerName: 'Nick Daicos', positions: ['Full Forward', 'Midfielder'] },
    ]);
  });

  test('vacating a slot clears the player rather than duplicating them', () => {
    const incoming = {
      Tackler: { player_name: 'Nick Daicos' },
      Midfielder: { player_name: '' },
    };
    expect(duplicatesIntroduced(stored, incoming)).toEqual([]);
  });

  test('a duplicate already stored in untouched positions is not this save to reject', () => {
    const messy = {
      Midfielder: { player_name: 'Nick Daicos' },
      Tackler: { player_name: 'Nick Daicos' },
    };
    expect(duplicatesIntroduced(messy, { 'Full Forward': { player_name: 'Jeremy Cameron' } })).toEqual([]);
  });
});

describe('positionsByPlayer', () => {
  test('maps each player to the position they fill, skipping empties and bookkeeping', () => {
    expect(positionsByPlayer(seasonTeam)).toEqual({
      'Jeremy Cameron': 'Full Forward',
      'Nick Daicos': 'Midfielder',
    });
    expect(positionsByPlayer(finalsTeam)).toEqual({
      'Jeremy Cameron': 'Full Forward',
      'Nick Daicos': 'Midfielder',
    });
  });
});

// The Duzza Finals pickers (the pool comp's own entry screens) run every pick
// through applyFinalsPick, so a player can never end up in two slots.
describe('applyFinalsPick', () => {
  const team = {
    'Full Forward': { player: 'Jeremy Cameron', club: 'GEE' },
    Midfielder: { player: 'Nick Daicos', club: 'COL' },
    Bench: { player: 'Zak Butters', club: 'PTA', backup_position: 'Ruck' },
  };

  test('an ordinary pick just fills the slot', () => {
    const next = applyFinalsPick(team, 'Tackler', 'Tim English', 'WBD');
    expect(next.Tackler).toEqual({ player: 'Tim English', club: 'WBD' });
    expect(findDuplicateSelections(next)).toEqual([]);
  });

  test('picking a player already in the team swaps the two slots', () => {
    const next = applyFinalsPick(team, 'Tackler', 'Nick Daicos', 'COL');
    expect(next.Tackler).toEqual({ player: 'Nick Daicos', club: 'COL' });
    expect(next.Midfielder).toEqual({});
    expect(findDuplicateSelections(next)).toEqual([]);
  });

  test('the swap hands the displaced player the slot they came from', () => {
    const next = applyFinalsPick(team, 'Full Forward', 'Nick Daicos', 'COL');
    expect(next['Full Forward']).toEqual({ player: 'Nick Daicos', club: 'COL' });
    expect(next.Midfielder).toEqual({ player: 'Jeremy Cameron', club: 'GEE' });
    expect(findDuplicateSelections(next)).toEqual([]);
  });

  test('backup position belongs to the bench slot, not to whoever fills it', () => {
    const swappedOut = applyFinalsPick(team, 'Midfielder', 'Zak Butters', 'PTA');
    expect(swappedOut.Bench).toEqual({ player: 'Nick Daicos', club: 'COL', backup_position: 'Ruck' });

    const swappedIn = applyFinalsPick(team, 'Bench', 'Nick Daicos', 'COL');
    expect(swappedIn.Bench).toEqual({ player: 'Nick Daicos', club: 'COL', backup_position: 'Ruck' });
    expect(swappedIn.Midfielder).toEqual({ player: 'Zak Butters', club: 'PTA' });
  });

  test('re-picking the player already in a slot leaves the rest alone', () => {
    expect(applyFinalsPick(team, 'Midfielder', 'Nick Daicos', 'COL')).toEqual(team);
  });

  test('clearing empties the slot, keeping the bench backup position', () => {
    expect(applyFinalsPick(team, 'Midfielder', null, null).Midfielder).toEqual({});
    expect(applyFinalsPick(team, 'Bench', null, null).Bench).toEqual({ backup_position: 'Ruck' });
  });

  test('the original team is never mutated', () => {
    const before = JSON.parse(JSON.stringify(team));
    applyFinalsPick(team, 'Tackler', 'Nick Daicos', 'COL');
    expect(team).toEqual(before);
  });
});

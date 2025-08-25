export const getNavigationGroups = (includeSquadManagement = false) => [
  [
    { name: 'Round Results', path: '/pages/results', id: 'results' },
  ],
  [
    { name: 'Enter Team', path: '/pages/team-selection', id: 'team-selection' },
    { name: 'Enter Tips', path: '/pages/tipping', id: 'tipping' },
  ],
  [
    { name: 'Season Ladder', path: '/pages/ladder', id: 'ladder' },
    { name: 'Tipping Ladder', path: '/pages/tipping-ladder', id: 'tipping-ladder' },
    { name: 'Tip Results', path: '/pages/tipping-results', id: 'tipping-results' },
  ],
  [
    { name: 'Squads', path: '/pages/squads', id: 'squads' },
    ...(includeSquadManagement ? [{ name: 'Squad Management', path: '/pages/squad-management', id: 'squad-management' }] : []),
  ],
];

export const debugNavigationItems = [
  { name: 'Round-by-Round', path: '/pages/round-by-round', id: 'round-by-round' },
  { name: 'Update Stats', path: '/pages/update-stats', id: 'update-stats' },
  { name: 'New Ladder', path: '/pages/store-ladder', id: 'store-ladder' },
];
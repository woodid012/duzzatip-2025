// app/lib/fixture_constants.js
export const FIXTURES = {
    // Regular Season (Rounds 1-21)
    1: [
      { home: 1, away: 2 },
      { home: 3, away: 4 },
      { home: 5, away: 6 },
      { home: 7, away: 8 }
    ],
    2: [
      { home: 1, away: 3 },
      { home: 2, away: 4 },
      { home: 5, away: 7 },
      { home: 6, away: 8 }
    ],
    3: [
      { home: 1, away: 4 },
      { home: 2, away: 3 },
      { home: 5, away: 8 },
      { home: 6, away: 7 }
    ],
    4: [
      { home: 1, away: 5 },
      { home: 2, away: 6 },
      { home: 3, away: 7 },
      { home: 4, away: 8 }
    ],
    5: [
      { home: 1, away: 6 },
      { home: 2, away: 5 },
      { home: 3, away: 8 },
      { home: 4, away: 7 }
    ],
    6: [
      { home: 1, away: 7 },
      { home: 2, away: 8 },
      { home: 3, away: 5 },
      { home: 4, away: 6 }
    ],
    7: [
      { home: 1, away: 8 },
      { home: 2, away: 7 },
      { home: 3, away: 6 },
      { home: 4, away: 5 }
    ],
    8: [
      { home: 2, away: 1 },
      { home: 4, away: 3 },
      { home: 6, away: 5 },
      { home: 8, away: 7 }
    ],
    9: [
      { home: 3, away: 1 },
      { home: 4, away: 2 },
      { home: 7, away: 5 },
      { home: 8, away: 6 }
    ],
    10: [
      { home: 4, away: 1 },
      { home: 3, away: 2 },
      { home: 8, away: 5 },
      { home: 7, away: 6 }
    ],
    11: [
      { home: 5, away: 1 },
      { home: 6, away: 2 },
      { home: 7, away: 3 },
      { home: 8, away: 4 }
    ],
    12: [
      { home: 6, away: 1 },
      { home: 5, away: 2 },
      { home: 8, away: 3 },
      { home: 7, away: 4 }
    ],
    13: [
      { home: 7, away: 1 },
      { home: 8, away: 2 },
      { home: 5, away: 3 },
      { home: 6, away: 4 }
    ],
    14: [
      { home: 8, away: 1 },
      { home: 7, away: 2 },
      { home: 6, away: 3 },
      { home: 5, away: 4 }
    ],
    15: [
      { home: 1, away: 2 },
      { home: 3, away: 4 },
      { home: 5, away: 6 },
      { home: 7, away: 8 }
    ],
    16: [
      { home: 1, away: 3 },
      { home: 2, away: 4 },
      { home: 5, away: 7 },
      { home: 6, away: 8 }
    ],
    17: [
      { home: 1, away: 4 },
      { home: 2, away: 3 },
      { home: 5, away: 8 },
      { home: 6, away: 7 }
    ],
    18: [
      { home: 1, away: 5 },
      { home: 2, away: 6 },
      { home: 3, away: 7 },
      { home: 4, away: 8 }
    ],
    19: [
      { home: 1, away: 6 },
      { home: 2, away: 5 },
      { home: 3, away: 8 },
      { home: 4, away: 7 }
    ],
    20: [
      { home: 1, away: 7 },
      { home: 2, away: 8 },
      { home: 3, away: 5 },
      { home: 4, away: 6 }
    ],
    21: [
      { home: 1, away: 8 },
      { home: 2, away: 7 },
      { home: 3, away: 6 },
      { home: 4, away: 5 }
    ],
    // Finals (Rounds 22-24)
    22: [
      { home: 'TBD1', away: 'TBD2' },
      { home: 'TBD3', away: 'TBD4' },
      { home: 'TBD5', away: 'TBD6' },
      { home: 'TBD7', away: 'TBD8' }
    ],
    23: [
      { home: 'SF1', away: 'SF2' },
      { home: 'SF3', away: 'SF4' }
    ],
    24: [
      { home: 'GF1', away: 'GF2' }
    ]
  };
  
  // Helper function to get fixture for a specific round
  export const getFixturesForRound = (round) => {
    return FIXTURES[round] || [];
  };
  
  // Helper function to find fixture involving a specific team
  export const getFixtureForTeam = (round, teamId) => {
    const roundFixtures = FIXTURES[round] || [];
    return roundFixtures.find(fixture => 
      fixture.home === teamId || fixture.away === teamId
    );
  };
  
  // Helper function to get opponent for a team in a specific round
  export const getOpponentForTeam = (round, teamId) => {
    const fixture = getFixtureForTeam(round, teamId);
    if (!fixture) return null;
    return fixture.home === teamId ? fixture.away : fixture.home;
  };
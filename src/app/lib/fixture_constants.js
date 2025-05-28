// app/lib/fixture_constants.js
export const FIXTURES = {
  // Pre-Season (Round 0) - no actual fixtures, just ranking
  0: [],
  // Regular Season (Rounds 1-21) - keeping your existing structure
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
  
  // ===== FINALS SERIES =====
  // Week 1 (Round 22) - Semi Finals
  22: [
    { 
      home: 1, 
      away: 2, 
      name: 'Semi Final 1 (1st vs 2nd)',
      type: 'semi_final',
      note: 'Winner advances to Grand Final'
    },
    { 
      home: 3, 
      away: 4, 
      name: 'Semi Final 2 (3rd vs 4th)',
      type: 'semi_final',
      note: 'Winner advances to Preliminary Final'
    }
  ],
  
  // Week 2 (Round 23) - Preliminary Final
  23: [
    { 
      home: 'SF1_LOSER', 
      away: 'SF2_WINNER', 
      name: 'Preliminary Final',
      type: 'preliminary_final',
      note: 'Winner advances to Grand Final'
    }
  ],
  
  // Week 3 (Round 24) - Grand Final
  24: [
    { 
      home: 'SF1_WINNER', 
      away: 'PF_WINNER', 
      name: 'Grand Final',
      type: 'grand_final',
      note: 'Championship Game'
    }
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

// NEW: Helper function to resolve finals fixtures based on ladder positions and results
export const getResolvedFinalsFixtures = (round, ladder, previousResults = {}) => {
  const fixtures = getFixturesForRound(round);
  
  if (round === 22) {
    // Semi Finals - use ladder positions directly
    return fixtures.map(fixture => ({
      ...fixture,
      home: ladder[parseInt(fixture.home) - 1]?.userId || fixture.home,
      away: ladder[parseInt(fixture.away) - 1]?.userId || fixture.away,
      homeName: ladder[parseInt(fixture.home) - 1]?.userName || `Position ${fixture.home}`,
      awayName: ladder[parseInt(fixture.away) - 1]?.userName || `Position ${fixture.away}`
    }));
  }
  
  if (round === 23) {
    // Preliminary Final - need results from Round 22
    const sf1Results = previousResults[22]?.find(r => r.fixture.name?.includes('Semi Final 1'));
    const sf2Results = previousResults[22]?.find(r => r.fixture.name?.includes('Semi Final 2'));
    
    if (!sf1Results || !sf2Results) {
      return fixtures.map(fixture => ({
        ...fixture,
        home: 'TBD (SF1 Loser)',
        away: 'TBD (SF2 Winner)',
        homeName: 'Semi Final 1 Loser',
        awayName: 'Semi Final 2 Winner'
      }));
    }
    
    // Determine winners and losers
    const sf1Winner = sf1Results.homeScore > sf1Results.awayScore ? sf1Results.homeTeam : sf1Results.awayTeam;
    const sf1Loser = sf1Results.homeScore > sf1Results.awayScore ? sf1Results.awayTeam : sf1Results.homeTeam;
    const sf2Winner = sf2Results.homeScore > sf2Results.awayScore ? sf2Results.homeTeam : sf2Results.awayTeam;
    
    return fixtures.map(fixture => ({
      ...fixture,
      home: sf1Loser,
      away: sf2Winner,
      homeName: `${sf1Loser} (SF1 Loser)`,
      awayName: `${sf2Winner} (SF2 Winner)`
    }));
  }
  
  if (round === 24) {
    // Grand Final - need results from Round 22 and 23
    const sf1Results = previousResults[22]?.find(r => r.fixture.name?.includes('Semi Final 1'));
    const pfResults = previousResults[23]?.find(r => r.fixture.name?.includes('Preliminary Final'));
    
    if (!sf1Results || !pfResults) {
      return fixtures.map(fixture => ({
        ...fixture,
        home: 'TBD (SF1 Winner)',
        away: 'TBD (PF Winner)',
        homeName: 'Semi Final 1 Winner',
        awayName: 'Preliminary Final Winner'
      }));
    }
    
    // Determine winners
    const sf1Winner = sf1Results.homeScore > sf1Results.awayScore ? sf1Results.homeTeam : sf1Results.awayTeam;
    const pfWinner = pfResults.homeScore > pfResults.awayScore ? pfResults.homeTeam : pfResults.awayTeam;
    
    return fixtures.map(fixture => ({
      ...fixture,
      home: sf1Winner,
      away: pfWinner,
      homeName: `${sf1Winner} (SF1 Winner)`,
      awayName: `${pfWinner} (PF Winner)`
    }));
  }
  
  return fixtures;
};
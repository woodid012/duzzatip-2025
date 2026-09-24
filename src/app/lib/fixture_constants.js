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

// app/lib/constants.js

export const CURRENT_YEAR = new Date().getFullYear();

// Initial values
export const LATEST_ROUND = 1;
export const IS_ROUND_ACTIVE = false;
export const ROUND_LOCKOUT_TIME = null;

// Hard-coded Opening Round (Round 0) closing time
export const OPENING_ROUND_END_TIME = new Date('2025-03-09T18:00:00+11:00'); // 6 PM AEDT, March 9th 2025

// Function to check if a round is active
export const getRoundStatus = (fixtures, roundNumber) => {
  if (!fixtures || !fixtures.length) return false;
  
  // Special case for Opening Round (Round 0)
  if (roundNumber === 0) {
    const now = new Date();
    return now < OPENING_ROUND_END_TIME;
  }
  
  const roundFixtures = fixtures.filter(f => f.RoundNumber.toString() === roundNumber.toString());
  if (!roundFixtures.length) return false;
  
  const now = new Date();
  const firstMatch = new Date(roundFixtures[0].DateUtc);
  const lastMatch = new Date(roundFixtures[roundFixtures.length - 1].DateUtc);
  
  return now >= firstMatch && now <= lastMatch;
};

// Function to get the latest round
export const getLatestRound = (fixtures) => {
  if (!fixtures || !fixtures.length) return 1; // Default to round 1
  
  const now = new Date();
  
  // If we're still in Opening Round period, return 0
  if (now < OPENING_ROUND_END_TIME) {
    return 0;
  }
  
  const futureFixtures = fixtures.filter(f => new Date(f.DateUtc) > now);
  
  if (futureFixtures.length === 0) {
    return Math.max(...fixtures.map(f => f.RoundNumber));
  }
  
  return futureFixtures[0].RoundNumber;
};

// Function to get round lockout time (earliest game in Melbourne time)
export const getRoundLockoutTime = (fixtures, roundNumber) => {
  if (!fixtures || !fixtures.length) return null;
  
  // Special case for Opening Round (Round 0)
  if (roundNumber === 0) {
    return OPENING_ROUND_END_TIME.toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    });
  }
  
  // Filter for the active round
  const roundFixtures = fixtures.filter(fixture => 
    fixture.RoundNumber.toString() === roundNumber.toString()
  ).map(fixture => ({
    ...fixture,
    DateUtc: new Date(fixture.DateUtc).toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    })
  }));
  
  if (!roundFixtures.length) return null;
  
  // Sort by date and get earliest
  return roundFixtures.sort((a, b) => 
    new Date(a.DateUtc) - new Date(b.DateUtc)
  )[0].DateUtc;
};

export const POSITION_TYPES = [
  'Full Forward', 
  'Tall Forward', 
  'Offensive', 
  'Midfielder', 
  'Tackler', 
  'Ruck', 
  'Bench',
  'Reserve A',
  'Reserve B'
];

export const BACKUP_POSITIONS = [
  'Full Forward', 
  'Tall Forward', 
  'Offensive', 
  'Midfielder', 
  'Tackler', 
  'Ruck'
];

export const USER_NAMES = {
  1: "flailing feathers",
  2: "Garvs Garden Gnomes",
  3: "Miguel's Marauders",
  4: "Le Mallards",
  5: "Rands Ruffians",
  6: "Balls Deep Briz",
  7: "Honour String",
  8: "pinga jinga jim"
};
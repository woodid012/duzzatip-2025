// app/lib/constants.js

export const CURRENT_YEAR = new Date().getFullYear();

// Initial values
export const LATEST_ROUND = 1;
export const IS_ROUND_ACTIVE = false;
export const ROUND_LOCKOUT_TIME = null;

// Function to check if a round is active
export const getRoundStatus = (fixtures, roundNumber) => {
  if (!fixtures || !fixtures.length) return false;
  
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
  const futureFixtures = fixtures.filter(f => new Date(f.DateUtc) > now);
  
  if (futureFixtures.length === 0) {
    return Math.max(...fixtures.map(f => f.RoundNumber));
  }
  
  return futureFixtures[0].RoundNumber;
};

// Function to get round lockout time (earliest game in Melbourne time)
export const getRoundLockoutTime = (fixtures, roundNumber) => {
  if (!fixtures || !fixtures.length) return null;
  
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
  1: "Feathers and noodle soup",
  2: "Sharky's Bite",
  3: "Full Metal Jacket Miguel",
  4: "Le Quack Attack",
  5: "Randy's Ruckin Roalercoaster",
  6: "Nightmare of Milky Briz",
  7: "String Theory",
  8: "Pinga Jinga Pillbox"
};
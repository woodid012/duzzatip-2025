// app/lib/constants.js

export const CURRENT_YEAR = new Date().getFullYear();

// Initial values
let LATEST_ROUND = 0;
let IS_ROUND_ACTIVE = false;
let ROUND_LOCKOUT_TIME = null;

// Function to check if a round is active
const getRoundStatus = (fixtures, roundNumber) => {
  if (!fixtures || !fixtures.length) return false;
  
  const roundFixtures = fixtures.filter(f => f.RoundNumber.toString() === roundNumber.toString());
  if (!roundFixtures.length) return false;
  
  const now = new Date();
  const firstMatch = new Date(roundFixtures[0].DateUtc);
  const lastMatch = new Date(roundFixtures[roundFixtures.length - 1].DateUtc);
  
  return now >= firstMatch && now <= lastMatch;
};

// Function to get the latest round
const getLatestRound = (fixtures) => {
  if (!fixtures || !fixtures.length) return 0;
  
  const now = new Date();
  const futureFixtures = fixtures.filter(f => new Date(f.DateUtc) > now);
  
  if (futureFixtures.length === 0) {
    return Math.max(...fixtures.map(f => f.RoundNumber));
  }
  
  return futureFixtures[0].RoundNumber;
};

// Function to get round lockout time (earliest game in Melbourne time)
const getRoundLockoutTime = (fixtures, roundNumber) => {
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

// Initialize the values
fetch(`https://fixturedownload.com/feed/json/afl-${CURRENT_YEAR}`)
  .then(response => response.json())
  .then(fixtures => {
    LATEST_ROUND = getLatestRound(fixtures);
    IS_ROUND_ACTIVE = getRoundStatus(fixtures, LATEST_ROUND);
    ROUND_LOCKOUT_TIME = getRoundLockoutTime(fixtures, LATEST_ROUND);
  })
  .catch(error => {
    console.error('Error fetching fixtures for constants:', error);
  });

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
  1: "Scrennys Soldiers",
  2: "Scotts Tots",
  3: "ROBbed",
  4: "Le Mallards",
  5: "Clarries Cookers",
  6: "Balls Deep Briz",
  7: "Strings Souvlakis",
  8: "Cutsys Cucks"
};

export { LATEST_ROUND, IS_ROUND_ACTIVE, ROUND_LOCKOUT_TIME };
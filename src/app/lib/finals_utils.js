// src/app/lib/finals_utils.js

import { USER_NAMES } from './constants';
import { getFixturesForRound } from './fixture_constants';

/**
 * Get the complete ladder at a specific round
 * @param {number} round - The round to get ladder for (typically 21)
 * @returns {Promise<Array>} Array of teams with their ladder positions
 */
export async function getLadderAtRound(round = 21) {
  try {
    const response = await fetch(`/api/simple-ladder?round=${round}`);
    if (!response.ok) {
      throw new Error('Failed to fetch ladder data');
    }
    
    const data = await response.json();
    return data.ladder || [];
  } catch (error) {
    console.error('Error fetching ladder:', error);
    return [];
  }
}

/**
 * Get finals results for completed finals matches
 * @param {number} round - The finals round (22, 23, or 24)
 * @returns {Promise<Object>} Object containing match results
 */
export async function getFinalsResults(round) {
  try {
    const response = await fetch(`/api/consolidated-round-results?round=${round}`);
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data.results || {};
  } catch (error) {
    console.error(`Error fetching finals results for round ${round}:`, error);
    return null;
  }
}

/**
 * Determine the winner and loser from a fixture based on results
 * @param {Object} fixture - The fixture object
 * @param {Object} results - The results object for all teams
 * @returns {Object} Object with winner and loser userIds
 */
function determineMatchWinner(fixture, results) {
  if (!results || !fixture.home || !fixture.away) {
    return { winner: null, loser: null };
  }
  
  const homeScore = results[fixture.home]?.totalScore || 0;
  const awayScore = results[fixture.away]?.totalScore || 0;
  
  if (homeScore === 0 && awayScore === 0) {
    return { winner: null, loser: null };
  }
  
  if (homeScore > awayScore) {
    return { winner: fixture.home, loser: fixture.away };
  } else if (awayScore > homeScore) {
    return { winner: fixture.away, loser: fixture.home };
  } else {
    // In case of a draw (shouldn't happen in finals)
    return { winner: null, loser: null };
  }
}

/**
 * Calculate and resolve finals fixtures based on ladder and previous results
 * @param {number} currentRound - The current round number
 * @returns {Promise<Array>} Array of resolved fixtures for the current round
 */
export async function calculateFinalsFixtures(currentRound) {
  // Get the complete ladder from end of regular season
  const ladder = await getLadderAtRound(21);
  
  if (ladder.length < 4) {
    console.error('Not enough teams for finals');
    return [];
  }
  
  // Get the top 4 teams
  const top4 = ladder.slice(0, 4);
  
  // Get base fixtures for the round
  let fixtures = getFixturesForRound(currentRound);
  
  if (currentRound === 22) {
    // Semi Finals - use ladder positions directly
    return fixtures.map((fixture, index) => {
      const isFirstSemi = index === 0;
      const homeTeam = isFirstSemi ? top4[0] : top4[2]; // 1st vs 3rd
      const awayTeam = isFirstSemi ? top4[1] : top4[3]; // 2nd vs 4th
      
      return {
        ...fixture,
        home: homeTeam.userId,
        away: awayTeam.userId,
        homeName: homeTeam.userName,
        awayName: awayTeam.userName,
        homePosition: isFirstSemi ? 1 : 3,
        awayPosition: isFirstSemi ? 2 : 4
      };
    });
  }
  
  if (currentRound === 23) {
    // Preliminary Final - need results from Round 22
    const semiFinalResults = await getFinalsResults(22);
    
    if (!semiFinalResults) {
      return fixtures.map(fixture => ({
        ...fixture,
        home: 'TBD',
        away: 'TBD',
        homeName: 'Semi Final 1 Loser',
        awayName: 'Semi Final 2 Winner',
        pending: true
      }));
    }
    
    // Get the semi final fixtures with teams
    const semiFixtures = await calculateFinalsFixtures(22);
    
    // Determine winners and losers
    const sf1Result = determineMatchWinner(semiFixtures[0], semiFinalResults);
    const sf2Result = determineMatchWinner(semiFixtures[1], semiFinalResults);
    
    if (!sf1Result.loser || !sf2Result.winner) {
      return fixtures.map(fixture => ({
        ...fixture,
        home: sf1Result.loser || 'TBD',
        away: sf2Result.winner || 'TBD',
        homeName: sf1Result.loser ? USER_NAMES[sf1Result.loser] : 'Semi Final 1 Loser',
        awayName: sf2Result.winner ? USER_NAMES[sf2Result.winner] : 'Semi Final 2 Winner',
        pending: !sf1Result.loser || !sf2Result.winner
      }));
    }
    
    return fixtures.map(fixture => ({
      ...fixture,
      home: sf1Result.loser,
      away: sf2Result.winner,
      homeName: USER_NAMES[sf1Result.loser],
      awayName: USER_NAMES[sf2Result.winner]
    }));
  }
  
  if (currentRound === 24) {
    // Grand Final - need results from Round 22 and 23
    const semiFinalResults = await getFinalsResults(22);
    const prelimResults = await getFinalsResults(23);
    
    if (!semiFinalResults) {
      return fixtures.map(fixture => ({
        ...fixture,
        home: 'TBD',
        away: 'TBD',
        homeName: 'Semi Final 1 Winner',
        awayName: 'Preliminary Final Winner',
        pending: true
      }));
    }
    
    // Get the semi final fixtures with teams
    const semiFixtures = await calculateFinalsFixtures(22);
    
    // Determine SF1 winner
    const sf1Result = determineMatchWinner(semiFixtures[0], semiFinalResults);
    
    if (!sf1Result.winner) {
      return fixtures.map(fixture => ({
        ...fixture,
        home: 'TBD',
        away: 'TBD',
        homeName: 'Semi Final 1 Winner',
        awayName: 'Preliminary Final Winner',
        pending: true
      }));
    }
    
    // If preliminary final hasn't been played yet
    if (!prelimResults) {
      return fixtures.map(fixture => ({
        ...fixture,
        home: sf1Result.winner,
        away: 'TBD',
        homeName: USER_NAMES[sf1Result.winner],
        awayName: 'Preliminary Final Winner',
        pending: true
      }));
    }
    
    // Get preliminary final fixture
    const prelimFixtures = await calculateFinalsFixtures(23);
    const pfResult = determineMatchWinner(prelimFixtures[0], prelimResults);
    
    if (!pfResult.winner) {
      return fixtures.map(fixture => ({
        ...fixture,
        home: sf1Result.winner,
        away: 'TBD',
        homeName: USER_NAMES[sf1Result.winner],
        awayName: 'Preliminary Final Winner',
        pending: true
      }));
    }
    
    return fixtures.map(fixture => ({
      ...fixture,
      home: sf1Result.winner,
      away: pfResult.winner,
      homeName: USER_NAMES[sf1Result.winner],
      awayName: USER_NAMES[pfResult.winner]
    }));
  }
  
  return fixtures;
}

/**
 * Check if a round is a finals round
 * @param {number} round - The round number
 * @returns {boolean} True if the round is a finals round
 */
export function isFinalRound(round) {
  return round >= 22 && round <= 24;
}

/**
 * Get the name of a finals round
 * @param {number} round - The round number
 * @returns {string} The name of the finals round
 */
export function getFinalsRoundName(round) {
  switch (round) {
    case 22:
      return 'Semi Finals';
    case 23:
      return 'Preliminary Final';
    case 24:
      return 'Grand Final';
    default:
      return `Round ${round}`;
  }
}
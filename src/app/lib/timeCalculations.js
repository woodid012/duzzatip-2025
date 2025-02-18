'use client'

import { LATEST_ROUND } from './constants';

// Test configuration
const TEST_DATE = new Date('2025-04-01');
const USE_TEST_DATE = true;  // Set to false to use real date

/**
 * Converts a UTC date to Melbourne time
 * @param {Date|string} dateUtc - UTC date to convert
 * @param {boolean} formatString - Whether to return a formatted string or Date object
 * @returns {string|Date} Melbourne time as formatted string or Date object
 */
export function convertToMelbourneTime(dateUtc, formatString = true) {
  const date = new Date(dateUtc);
  if (!formatString) return date;
  
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });
}

/**
 * Parse a Melbourne time string into a Date object
 * @param {string} timeStr - Time string in format "3 April 2025 at 7:30 pm"
 * @returns {Date|null} Parsed date object or null if invalid
 */
export function parseMelbourneTime(timeStr) {
  if (!timeStr) return null;
  try {
    // Expected format: "3 April 2025 at 7:30 pm"
    const match = timeStr.match(/^(\d+)\s+(\w+)\s+(\d{4})\s+at\s+(\d+):(\d+)\s+(am|pm)$/i);
    if (!match) {
      console.warn('Invalid date format:', timeStr);
      return null;
    }

    const [_, day, month, year, hours, minutes, period] = match;
    
    let hour = parseInt(hours);
    if (period.toLowerCase() === 'pm' && hour !== 12) {
      hour += 12;
    } else if (period.toLowerCase() === 'am' && hour === 12) {
      hour = 0;
    }
    
    const date = new Date(`${month} ${day}, ${year} ${hour}:${minutes}:00`);
    if (isNaN(date.getTime())) {
      console.warn('Invalid date created:', timeStr);
      return null;
    }
    
    return date;
  } catch (error) {
    console.error('Error parsing Melbourne time:', error);
    return null;
  }
}

/**
 * Process fixtures with Melbourne time
 * @param {Array} fixtures - Array of fixture objects
 * @returns {Array} Processed fixtures with Melbourne dates
 */
export function processFixtures(fixtures) {
  return fixtures.map(fixture => ({
    ...fixture,
    DateUtc: new Date(fixture.DateUtc),
    DateMelb: convertToMelbourneTime(fixture.DateUtc)
  }));
}

/**
 * Calculate current round based on fixture dates
 * @param {Array} fixtures - Array of processed fixture objects
 * @param {Date} [currentDate] - Optional date to use instead of now
 * @returns {Object} Current round info and next round lockout
 */
export function calculateRoundInfo(fixtures, currentDate = null) {
  if (!fixtures?.length) {
    return {
      currentRound: LATEST_ROUND,
      currentRoundDisplay: LATEST_ROUND === 0 ? 'Opening Round' : LATEST_ROUND,
      lockoutTime: null,
      roundEndTime: null,
      isError: true
    };
  }

  try {
    // Sort fixtures by date
    const sortedFixtures = fixtures.sort((a, b) => 
      a.DateUtc - b.DateUtc
    );

    // Use provided date, test date, or real date
    const now = currentDate || (USE_TEST_DATE ? TEST_DATE : new Date());
    console.log('Current date (Melbourne):', convertToMelbourneTime(now));

    // Find next fixture
    const nextFixture = sortedFixtures.find(fixture => 
      fixture.DateUtc > now
    );

    // Calculate current round
    const currentRound = nextFixture 
      ? Math.max(0, nextFixture.RoundNumber - 1)  // Ensure we don't go below 0
      : sortedFixtures[sortedFixtures.length - 1].RoundNumber;

    // Get next round's fixtures for lockout
    const nextRoundFixtures = fixtures.filter(
      fixture => fixture.RoundNumber === (currentRound + 1)
    );

    // Get lockout time (earliest game of next round)
    const lockoutTime = nextRoundFixtures.length 
      ? nextRoundFixtures.sort((a, b) => a.DateUtc - b.DateUtc)[0].DateMelb
      : null;

    // Calculate round end time (3 hours after the last game of next round starts)
    let roundEndTime = null;
    if (nextRoundFixtures.length) {
      const lastGame = nextRoundFixtures.sort((a, b) => b.DateUtc - a.DateUtc)[0];
      const endDate = new Date(lastGame.DateUtc);
      endDate.setHours(endDate.getHours() + 3);
      roundEndTime = convertToMelbourneTime(endDate);
    }

    return {
      currentRound,
      currentRoundDisplay: currentRound === 0 ? 'Opening Round' : currentRound,
      lockoutTime,
      roundEndTime,
      isError: false
    };
  } catch (error) {
    console.error('Error calculating round info:', error);
    return {
      currentRound: LATEST_ROUND,
      currentRoundDisplay: LATEST_ROUND === 0 ? 'Opening Round' : LATEST_ROUND,
      lockoutTime: null,
      roundEndTime: null,
      isError: true
    };
  }
}

/**
 * Get round information for a specific round
 * @param {Array} fixtures - Array of processed fixture objects
 * @param {number} roundNumber - The round number to get info for
 * @returns {Object} Round information including lockout and end times
 */
export function getRoundInfo(fixtures, roundNumber) {
  if (!fixtures?.length) {
    return {
      currentRound: roundNumber,
      currentRoundDisplay: roundNumber === 0 ? 'Opening Round' : roundNumber,
      lockoutTime: null,
      roundEndTime: null,
      isError: true,
      firstGameDate: null
    };
  }

  try {
    // Get the specific round info for the selected round
    const selectedRoundFixtures = fixtures.filter(
      fixture => fixture.RoundNumber === roundNumber
    );
    
    // Sort by date to get first game
    const firstGameOfRound = selectedRoundFixtures.length > 0 
      ? selectedRoundFixtures.sort((a, b) => a.DateUtc - b.DateUtc)[0] 
      : null;
      
    // Get last game for round end time
    const lastGameOfRound = selectedRoundFixtures.length > 0
      ? selectedRoundFixtures.sort((a, b) => b.DateUtc - a.DateUtc)[0]
      : null;
      
    // Calculate round end time (3 hours after last game)
    let roundEndTime = null;
    if (lastGameOfRound) {
      const endDate = new Date(lastGameOfRound.DateUtc);
      endDate.setHours(endDate.getHours() + 3);
      roundEndTime = convertToMelbourneTime(endDate);
    }
    
    // Check if we should be locked
    const now = USE_TEST_DATE ? TEST_DATE : new Date();
    const isLocked = firstGameOfRound ? now >= firstGameOfRound.DateUtc : false;
    
    return {
      currentRound: roundNumber,
      currentRoundDisplay: roundNumber === 0 ? 'Opening Round' : roundNumber,
      lockoutTime: firstGameOfRound?.DateMelb || null,
      roundEndTime,
      isError: false,
      isLocked
    };
  } catch (error) {
    console.error('Error getting round info:', error);
    return {
      currentRound: roundNumber,
      currentRoundDisplay: roundNumber === 0 ? 'Opening Round' : roundNumber,
      lockoutTime: null,
      roundEndTime: null,
      isError: true
    };
  }
}
'use client'

import { LATEST_ROUND } from './constants';

// Test configuration
const TEST_DATE = new Date('2025-05-06T19:00:00');
const USE_TEST_DATE = false;  // Set to false to use real date

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
/**
 * Converts time between different Australian time zones
 * @param {Date|string} date - Date to convert
 * @param {string} fromTimeZone - Source time zone ('AEST', 'AEDT', 'AWST', etc.)
 * @param {string} toTimeZone - Target time zone ('AEST', 'AEDT', 'AWST', etc.)
 * @param {boolean} formatString - Whether to return a formatted string
 * @returns {Date|string} Converted time
 */
export function convertBetweenTimeZones(date, fromTimeZone, toTimeZone, formatString = true) {
  // Time zone offset map in hours
  const timeZoneOffsets = {
    'AEST': 10,  // Australian Eastern Standard Time
    'AEDT': 11,  // Australian Eastern Daylight Time
    'ACST': 9.5, // Australian Central Standard Time
    'ACDT': 10.5,// Australian Central Daylight Time
    'AWST': 8,   // Australian Western Standard Time
    'UTC': 0     // Universal Time Coordinated
  };
  
  if (!timeZoneOffsets[fromTimeZone] !== undefined || !timeZoneOffsets[toTimeZone] !== undefined) {
    console.error('Invalid time zone specified');
    return date;
  }
  
  // Parse the date if it's a string
  const dateObj = typeof date === 'string' ? new Date(date) : new Date(date);
  
  // Calculate the time difference in milliseconds
  const offsetDiff = (timeZoneOffsets[toTimeZone] - timeZoneOffsets[fromTimeZone]) * 60 * 60 * 1000;
  
  // Apply the offset
  const convertedDate = new Date(dateObj.getTime() + offsetDiff);
  
  // Return as date object or formatted string
  if (!formatString) return convertedDate;
  
  // Format the date string based on the target time zone
  return convertedDate.toLocaleString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });
}

/**
 * Specifically converts Melbourne time (AEST/AEDT) to Perth time (AWST)
 * @param {Date|string} date - Date in Melbourne time
 * @param {boolean} formatString - Whether to return a formatted string
 * @returns {Date|string} Date in Perth time
 */
export function melbourneToPerthTime(date, formatString = true) {
  // Determine if date is in AEST or AEDT based on month
  // This is a simplification - a proper implementation would check exact DST dates
  const dateObj = typeof date === 'string' ? new Date(date) : new Date(date);
  const month = dateObj.getMonth(); // 0-11
  
  // Australia DST is roughly October to April
  const isDST = month >= 9 || month <= 3; 
  const fromTimeZone = isDST ? 'AEDT' : 'AEST';
  
  return convertBetweenTimeZones(date, fromTimeZone, 'AWST', formatString);
}

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
    
    // Set lockout time based on the current round
    let lockoutTime = null;
    let lockoutDate = null;
    
    if (roundNumber === 0) {
      // For round 0, the lockout is its own first game
      lockoutTime = firstGameOfRound?.DateMelb || null;
      lockoutDate = firstGameOfRound?.DateUtc || null;
    } else {
      // For all other rounds, use the first game of the round
      lockoutTime = firstGameOfRound?.DateMelb || null;
      lockoutDate = firstGameOfRound?.DateUtc || null;
    }
    
    // Check if the round is locked based on the current time vs. lockout date
    const isLocked = lockoutDate ? now >= lockoutDate : false;
    
    // Also get round 1 info if this is round 0
    let round1LockoutTime = null;
    let round1LockoutDate = null;
    
    if (roundNumber === 0) {
      const round1Fixtures = fixtures.filter(fixture => fixture.RoundNumber === 1);
      if (round1Fixtures.length > 0) {
        const firstGameOfRound1 = round1Fixtures.sort((a, b) => a.DateUtc - b.DateUtc)[0];
        round1LockoutTime = firstGameOfRound1?.DateMelb || null;
        round1LockoutDate = firstGameOfRound1?.DateUtc || null;
      }
    }
    
    return {
      currentRound: roundNumber,
      currentRoundDisplay: roundNumber === 0 ? 'Opening Round' : roundNumber,
      lockoutTime,
      lockoutDate,
      roundEndTime,
      round1LockoutTime, // Add round 1 lockout info for round 0
      round1LockoutDate,
      isError: false,
      isLocked,
      // Add a flag whether round 1 has started yet
      isRound1Started: roundNumber === 0 && round1LockoutDate ? now >= round1LockoutDate : false
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

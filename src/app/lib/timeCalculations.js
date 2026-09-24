'use client'

import { LATEST_ROUND } from './constants';

// Test configuration
const TEST_DATE = new Date('2025-05-06T19:00:00');
const USE_TEST_DATE = false;  // Set to false to use real date
const DAYS_BEFORE_ADVANCE = 2; // Number of days before first fixture to advance to next round

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
    const sortedFixtures = [...fixtures].sort((a, b) => 
      a.DateUtc - b.DateUtc
    );

    // Use provided date, test date, or real date
    const now = currentDate || (USE_TEST_DATE ? TEST_DATE : new Date());
    console.log('Current date (Melbourne):', convertToMelbourneTime(now));

    // Find next fixture
    const nextFixture = sortedFixtures.find(fixture => 
      fixture.DateUtc > now
    );

    // Calculate current round based on fixtures and current time
    let currentRound = LATEST_ROUND;
    
    if (nextFixture) {
      // If there's a next fixture, current round is either that round or the previous one
      const nextRound = nextFixture.RoundNumber;
      
      // Check if we're in the period where we should show the next round
      const nextRoundFixtures = fixtures.filter(f => f.RoundNumber === nextRound);
      if (nextRoundFixtures.length > 0) {
        const firstGameOfNextRound = nextRoundFixtures.sort((a, b) => a.DateUtc - b.DateUtc)[0];
        const advanceDate = new Date(firstGameOfNextRound.DateUtc);
        advanceDate.setDate(advanceDate.getDate() - DAYS_BEFORE_ADVANCE);
        
        if (now >= advanceDate) {
          currentRound = nextRound;
        } else {
          // Find the current/most recent completed round
          const pastFixtures = sortedFixtures.filter(fixture => fixture.DateUtc <= now);
          if (pastFixtures.length > 0) {
            currentRound = Math.max(...pastFixtures.map(f => f.RoundNumber));
          } else {
            // No past fixtures at all — pre-season, show the first upcoming round
            currentRound = nextRound;
          }
        }
      }
    } else {
      // No future fixtures, use the last round
      currentRound = Math.max(...fixtures.map(f => f.RoundNumber));
    }

    // Get fixtures for current round
    const currentRoundFixtures = fixtures.filter(
      fixture => fixture.RoundNumber === currentRound
    );
    
    // Get next round fixtures
    const nextRoundFixtures = fixtures.filter(
      fixture => fixture.RoundNumber === (currentRound + 1)
    );

    // If current round has fixtures and next round also has fixtures
    if (currentRoundFixtures.length > 0 && nextRoundFixtures.length > 0) {
      // Sort to get last game of current round
      const lastGameOfCurrentRound = currentRoundFixtures.sort((a, b) => b.DateUtc - a.DateUtc)[0];
      
      // Sort to get first game of next round
      const firstGameOfNextRound = nextRoundFixtures.sort((a, b) => a.DateUtc - b.DateUtc)[0];
      
      // Calculate date to advance to next round (2 days before first fixture)
      const advanceDate = new Date(firstGameOfNextRound.DateUtc);
      advanceDate.setDate(advanceDate.getDate() - DAYS_BEFORE_ADVANCE);
      
      // If current time is after last game of current round + 3 hours 
      // AND current time is within DAYS_BEFORE_ADVANCE days of next round's first fixture
      if (now > new Date(lastGameOfCurrentRound.DateUtc.getTime() + 3 * 60 * 60 * 1000) && 
          now >= advanceDate) {
        // Advance to next round early
        currentRound = currentRound + 1;
        console.log(`Advancing to Round ${currentRound} early (${DAYS_BEFORE_ADVANCE} days before first fixture)`);
      }
    }

    // Get lockout time (earliest game of next round)
    const lockoutTime = nextRoundFixtures.length 
      ? nextRoundFixtures.sort((a, b) => a.DateUtc - b.DateUtc)[0].DateMelb
      : null;

    // Calculate round end time (3 hours after the last game of current round starts)
    let roundEndTime = null;
    
    if (currentRoundFixtures.length) {
      const lastGame = currentRoundFixtures.sort((a, b) => b.DateUtc - a.DateUtc)[0];
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
    let roundEndDate = null;
    if (lastGameOfRound) {
      const endDate = new Date(lastGameOfRound.DateUtc);
      endDate.setHours(endDate.getHours() + 3);
      roundEndTime = convertToMelbourneTime(endDate);
      roundEndDate = endDate;
    }
    
    // Check if we should be locked
    const now = USE_TEST_DATE ? TEST_DATE : new Date();
    
    // Set lockout time based on the current round
    let lockoutTime = null;
    let lockoutDate = null;
    
    // For regular rounds, use the first game of the round
    lockoutTime = firstGameOfRound?.DateMelb || null;
    lockoutDate = firstGameOfRound?.DateUtc || null;
    
    // Check if the round is locked based on the current time vs. lockout date
    const isLocked = lockoutDate ? now >= lockoutDate : false;
    
    // Get next round info
    let nextRoundLockoutTime = null;
    let nextRoundLockoutDate = null;
    
    const nextRoundFixtures = fixtures.filter(fixture => fixture.RoundNumber === roundNumber + 1);
    if (nextRoundFixtures.length > 0) {
      const firstGameOfNextRound = nextRoundFixtures.sort((a, b) => a.DateUtc - b.DateUtc)[0];
      nextRoundLockoutTime = firstGameOfNextRound?.DateMelb || null;
      nextRoundLockoutDate = firstGameOfNextRound?.DateUtc || null;
    }
    
    // Check if we should advance to next round early (2 days before first fixture)
    const shouldAdvanceEarly = () => {
      if (!nextRoundLockoutDate) return false;
      
      // Check if current round has ended
      const isRoundEnded = roundEndDate ? now >= roundEndDate : false;
      
      // Calculate date to advance (DAYS_BEFORE_ADVANCE days before next round starts)
      const advanceDate = new Date(nextRoundLockoutDate);
      advanceDate.setDate(advanceDate.getDate() - DAYS_BEFORE_ADVANCE);
      
      // Check if current time is past the advance date AND round has ended
      return isRoundEnded && now >= advanceDate;
    };
    
    // Create a full nextRoundInfo object
    const nextRoundInfo = nextRoundFixtures.length > 0 ? {
      round: roundNumber + 1,
      lockoutTime: nextRoundLockoutTime,
      lockoutDate: nextRoundLockoutDate,
      isNextRoundStarted: nextRoundLockoutDate ? now >= nextRoundLockoutDate : false
    } : null;
    
    // Determine if we should advance to next round
    const shouldAdvance = shouldAdvanceEarly();
    
    return {
      currentRound: roundNumber,
      currentRoundDisplay: roundNumber === 0 ? 'Opening Round' : roundNumber,
      lockoutTime,
      lockoutDate,
      roundEndTime,
      roundEndDate,
      nextRoundLockoutTime, 
      nextRoundLockoutDate,
      nextRoundInfo,
      isError: false,
      isLocked,
      // Add a flag whether next round has started yet
      isNextRoundStarted: nextRoundLockoutDate ? now >= nextRoundLockoutDate : false,
      // Add a flag whether current round has ended
      isRoundEnded: roundEndDate ? now >= roundEndDate : false,
      // Add a flag to indicate if we should advance to next round early
      shouldAdvanceToNextRound: shouldAdvance
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

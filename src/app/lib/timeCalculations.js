'use client'

import { LATEST_ROUND } from './constants';

// Test configuration
const TEST_DATE = new Date('2025-04-01');
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
 * @returns {Object} Current round info and next round lockout
 */
export function calculateRoundInfo(fixtures) {
  if (!fixtures?.length) {
    return {
      currentRound: LATEST_ROUND,
      currentRoundDisplay: LATEST_ROUND === 0 ? 'Opening Round' : LATEST_ROUND,
      lockoutTime: null,
      isError: true
    };
  }

  try {
    // Sort fixtures by date
    const sortedFixtures = fixtures.sort((a, b) => 
      a.DateUtc - b.DateUtc
    );

    // Use test date or real date
    const now = USE_TEST_DATE ? TEST_DATE : new Date();
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

    // Log info for debugging
    console.log('Next fixture:', nextFixture ? convertToMelbourneTime(nextFixture.DateUtc) : 'None');
    console.log('Current round:', currentRound);
    console.log('Next round lockout:', lockoutTime);

    return {
      currentRound,
      currentRoundDisplay: currentRound === 0 ? 'Opening Round' : currentRound,
      lockoutTime,
      isError: false
    };
  } catch (error) {
    console.error('Error calculating round info:', error);
    return {
      currentRound: LATEST_ROUND,
      currentRoundDisplay: LATEST_ROUND === 0 ? 'Opening Round' : LATEST_ROUND,
      lockoutTime: null,
      isError: true
    };
  }
}
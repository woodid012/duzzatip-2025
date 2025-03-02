/**
 * AFL Stats Parser
 * 
 * Separate module for fetching and parsing AFL match statistics
 * This allows the logic to be reused and maintained separately
 */

const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Standardize team names for consistency between different data sources
 */
const TEAM_NAME_MAP = {
  'Brisbane Lions': 'Brisbane',
  'Gold Coast Suns': 'Gold Coast',
  'West Coast Eagles': 'West Coast',
  'GWS Giants': 'Greater Western Sydney',
  'Sydney Swans': 'Sydney',
  // Add more mappings as needed
};

/**
 * Parse player stats from AFL match data
 * @param {Object} fixture - Match fixture information
 * @param {boolean} useDemoData - Whether to use demo data (for testing)
 * @returns {Array} Array of player statistics
 */
async function getMatchStats(fixture, useDemoData = false) {
  if (useDemoData) {
    return generateDemoStats(fixture);
  }
  
  try {
    // In a real implementation, this would fetch data from an actual source
    // For example, from the AFL website or a stats provider API
    console.log(`Fetching match stats for: ${fixture.homeTeam} vs ${fixture.awayTeam}`);
    
    // This is where you would make the actual data fetch
    // const response = await axios.get(`https://some-afl-stats-api.com/match/${fixture.matchNumber}`);
    // const data = response.data;
    
    // Then parse the data into the required format
    // return parseStatsFromSource(data, fixture);
    
    // For now, generate demo data
    return generateDemoStats(fixture);
  } catch (error) {
    console.error(`Error fetching match stats: ${error.message}`);
    return [];
  }
}

/**
 * Generate demo player statistics for testing
 * @param {Object} fixture - Match fixture information
 * @returns {Array} Array of player statistics
 */
function generateDemoStats(fixture) {
  const homeTeamPlayers = generateTeamPlayers(fixture.homeTeam, fixture.awayTeam, true, fixture);
  const awayTeamPlayers = generateTeamPlayers(fixture.awayTeam, fixture.homeTeam, false, fixture);
  
  return [...homeTeamPlayers, ...awayTeamPlayers];
}

/**
 * Generate player statistics for a team
 * @param {string} teamName - Name of the team
 * @param {string} oppTeam - Name of the opposing team
 * @param {boolean} isHome - Whether this is the home team
 * @param {Object} fixture - Match fixture information
 * @returns {Array} Array of player statistics
 */
function generateTeamPlayers(teamName, oppTeam, isHome, fixture) {
  const players = [];
  const playerCount = 22; // Standard AFL team size
  
  // Use team position to influence player performance
  // This creates more realistic stats based on assumed team strength
  const teamStrength = Math.random() + 0.5; // 0.5 to 1.5 multiplier
  
  for (let i = 1; i <= playerCount; i++) {
    const playerPosition = getPlayerPosition(i);
    
    // Generate random stats based on player position
    const stats = generatePlayerStats(playerPosition, teamStrength);
    
    players.push({
      player_name: `${teamName} Player ${i}`,
      player_id: `${teamName.replace(/\s+/g, '')}_${i}`,
      team_name: teamName,
      opp: oppTeam,
      ...stats,
      position: playerPosition,
      round: fixture.round,
      match_number: fixture.matchNumber,
      year: new Date().getFullYear(),
      is_home: isHome
    });
  }
  
  return players;
}

/**
 * Determine player position based on player number
 * @param {number} playerNumber - Player's number in the team list
 * @returns {string} Player position
 */
function getPlayerPosition(playerNumber) {
  if (playerNumber <= 2) return 'Ruck';
  if (playerNumber <= 8) return 'Midfielder';
  if (playerNumber <= 12) return 'Defender';
  if (playerNumber <= 18) return 'Forward';
  return 'Utility';
}

/**
 * Generate realistic player statistics based on position
 * @param {string} position - Player position
 * @param {number} teamStrength - Team strength multiplier
 * @returns {Object} Player statistics
 */
function generatePlayerStats(position, teamStrength) {
  // Base stats modified by position and team strength
  let kicks, handballs, marks, tackles, hitouts, goals, behinds;
  
  switch (position) {
    case 'Ruck':
      kicks = randomStat(5, 12, teamStrength);
      handballs = randomStat(4, 10, teamStrength);
      marks = randomStat(3, 8, teamStrength);
      tackles = randomStat(2, 6, teamStrength);
      hitouts = randomStat(20, 40, teamStrength);
      goals = randomStat(0, 2, teamStrength);
      behinds = randomStat(0, 2, teamStrength);
      break;
    case 'Midfielder':
      kicks = randomStat(10, 20, teamStrength);
      handballs = randomStat(8, 15, teamStrength);
      marks = randomStat(3, 8, teamStrength);
      tackles = randomStat(4, 10, teamStrength);
      hitouts = randomStat(0, 2, teamStrength);
      goals = randomStat(0, 2, teamStrength);
      behinds = randomStat(0, 2, teamStrength);
      break;
    case 'Defender':
      kicks = randomStat(8, 15, teamStrength);
      handballs = randomStat(5, 12, teamStrength);
      marks = randomStat(4, 10, teamStrength);
      tackles = randomStat(2, 6, teamStrength);
      hitouts = 0;
      goals = randomStat(0, 1, teamStrength);
      behinds = randomStat(0, 1, teamStrength);
      break;
    case 'Forward':
      kicks = randomStat(8, 15, teamStrength);
      handballs = randomStat(3, 8, teamStrength);
      marks = randomStat(4, 10, teamStrength);
      tackles = randomStat(1, 5, teamStrength);
      hitouts = 0;
      goals = randomStat(1, 4, teamStrength);
      behinds = randomStat(1, 3, teamStrength);
      break;
    default: // Utility
      kicks = randomStat(6, 12, teamStrength);
      handballs = randomStat(4, 10, teamStrength);
      marks = randomStat(3, 6, teamStrength);
      tackles = randomStat(2, 5, teamStrength);
      hitouts = 0;
      goals = randomStat(0, 2, teamStrength);
      behinds = randomStat(0, 2, teamStrength);
  }
  
  const disposals = kicks + handballs;
  const centreBounceAttendances = position === 'Midfielder' || position === 'Ruck' 
    ? randomStat(5, 15, teamStrength) : randomStat(0, 3, teamStrength);
  
  const kickIns = position === 'Defender' ? randomStat(0, 5, teamStrength) : 0;
  const kickInsPlayon = Math.floor(kickIns * 0.7); // 70% of kick-ins are play on
  
  const timeOnGroundPercentage = randomStat(60, 90, teamStrength);
  
  // Calculate fantasy points
  const dreamTeamPoints = 
    kicks * 3 + 
    handballs * 2 + 
    marks * 3 + 
    tackles * 4 + 
    hitouts + 
    goals * 6 + 
    behinds;
  
  // SuperCoach has more variance
  const SC = dreamTeamPoints + randomStat(-10, 20, 1);
  
  return {
    kicks,
    handballs,
    disposals,
    marks,
    tackles,
    hitouts,
    goals,
    behinds,
    centreBounceAttendances,
    kickIns,
    kickInsPlayon,
    timeOnGroundPercentage,
    dreamTeamPoints,
    SC
  };
}

/**
 * Generate a random statistic within a range, modified by team strength
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} multiplier - Strength multiplier
 * @returns {number} Random statistic
 */
function randomStat(min, max, multiplier = 1) {
  return Math.floor((Math.random() * (max - min + 1) + min) * multiplier);
}

/**
 * Standardize team name
 * @param {string} teamName - Raw team name
 * @returns {string} Standardized team name
 */
function standardizeTeamName(teamName) {
  return TEAM_NAME_MAP[teamName] || teamName;
}

module.exports = {
  getMatchStats,
  standardizeTeamName
};

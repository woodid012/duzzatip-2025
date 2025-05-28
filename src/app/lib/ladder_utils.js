// app/lib/ladder_utils.js
import { USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound, getResolvedFinalsFixtures } from '@/app/lib/fixture_constants';

/**
 * Calculate the ladder standings based on team results up to a specific round
 * @param {Object} allTeamScores - Object containing team scores for all rounds
 * @param {Number} currentRound - Current round to calculate standings up to
 * @returns {Array} Sorted ladder standings
 */
export function calculateLadder(allTeamScores, currentRound) {
  // Initialize ladder with all users
  const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
    userId,
    userName,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    percentage: 0,
    points: 0
  }));

  // Skip round 0 (opening round) for ladder calculations
  // Process regular season rounds (1-21) only for ladder standings
  for (let round = 1; round <= Math.min(currentRound, 21); round++) {
    if (!allTeamScores[round]) continue;
    
    // Get fixtures for this round
    const fixtures = getFixturesForRound(round);
    
    fixtures.forEach(fixture => {
      const homeUserId = String(fixture.home);
      const awayUserId = String(fixture.away);
      
      // Skip if scores aren't available for either team
      if (!allTeamScores[round][homeUserId] || !allTeamScores[round][awayUserId]) {
        return;
      }
      
      const homeScore = allTeamScores[round][homeUserId];
      const awayScore = allTeamScores[round][awayUserId];
      
      const homeLadder = ladder.find(entry => entry.userId === homeUserId);
      const awayLadder = ladder.find(entry => entry.userId === awayUserId);
      
      if (homeLadder && awayLadder) {
        homeLadder.played += 1;
        awayLadder.played += 1;
        
        homeLadder.pointsFor += homeScore;
        homeLadder.pointsAgainst += awayScore;
        
        awayLadder.pointsFor += awayScore;
        awayLadder.pointsAgainst += homeScore;
        
        if (homeScore > awayScore) {
          // Home team wins
          homeLadder.wins += 1;
          homeLadder.points += 4;
          awayLadder.losses += 1;
        } else if (awayScore > homeScore) {
          // Away team wins
          awayLadder.wins += 1;
          awayLadder.points += 4;
          homeLadder.losses += 1;
        } else {
          // Draw
          homeLadder.draws += 1;
          homeLadder.points += 2;
          awayLadder.draws += 1;
          awayLadder.points += 2;
        }
      }
    });
  }

  // Calculate percentages
  ladder.forEach(team => {
    team.percentage = team.pointsAgainst === 0 
      ? team.pointsFor * 100 // Avoid division by zero
      : ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
  });

  // Sort ladder by points, then percentage
  return ladder.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return b.percentage - a.percentage;
  });
}

/**
 * Get finals fixtures based on ladder positions and previous results
 * @param {Array} ladder - Calculated ladder standings  
 * @param {Number} finalRound - Finals round (22, 23, or 24)
 * @param {Object} previousResults - Results from previous finals rounds
 * @returns {Array} Finals fixtures for the specified round
 */
export function getFinalFixtures(ladder, finalRound, previousResults = {}) {
  return getResolvedFinalsFixtures(finalRound, ladder, previousResults);
}

/**
 * Determine if the current round is a finals round
 * @param {Number} round - Current round number
 * @returns {Boolean} True if the round is a finals round
 */
export function isFinalRound(round) {
  return round >= 22 && round <= 24;
}

/**
 * Get the name/title of the finals round
 * @param {Number} round - Current round number
 * @returns {String} Name of the finals round
 */
export function getFinalRoundName(round) {
  switch (round) {
    case 22:
      return "Semi Finals (Week 1)";
    case 23:
      return "Preliminary Final (Week 2)";
    case 24:
      return "Grand Final (Week 3)";
    default:
      return `Round ${round}`;
  }
}

/**
 * Get detailed finals information including bracket structure
 * @param {Array} ladder - Current ladder standings
 * @param {Object} allResults - All finals results to date
 * @returns {Object} Finals bracket information
 */
export function getFinalsInfo(ladder, allResults = {}) {
  const info = {
    qualified: ladder.slice(0, 4), // Top 4 teams
    bracket: {
      week1: {
        game1: {
          teams: [ladder[0], ladder[1]],
          name: "Semi Final 1 (1st vs 2nd)",
          note: "Winner advances to Grand Final"
        },
        game2: {
          teams: [ladder[2], ladder[3]], 
          name: "Semi Final 2 (3rd vs 4th)",
          note: "Winner advances to Preliminary Final"
        }
      },
      week2: {
        game1: {
          teams: ["SF1 Loser", "SF2 Winner"],
          name: "Preliminary Final",
          note: "Winner advances to Grand Final"
        }
      },
      week3: {
        game1: {
          teams: ["SF1 Winner", "PF Winner"],
          name: "Grand Final", 
          note: "Championship Game"
        }
      }
    }
  };
  
  // If we have results, resolve the TBD teams
  if (allResults[22]) {
    const sf1Result = allResults[22].find(r => r.fixture?.name?.includes('Semi Final 1'));
    const sf2Result = allResults[22].find(r => r.fixture?.name?.includes('Semi Final 2'));
    
    if (sf1Result && sf2Result) {
      const sf1Winner = sf1Result.homeScore > sf1Result.awayScore ? sf1Result.homeTeam : sf1Result.awayTeam;
      const sf1Loser = sf1Result.homeScore > sf1Result.awayScore ? sf1Result.awayTeam : sf1Result.homeTeam;
      const sf2Winner = sf2Result.homeScore > sf2Result.awayScore ? sf2Result.homeTeam : sf2Result.awayTeam;
      
      // Update Week 2
      info.bracket.week2.game1.teams = [sf1Loser, sf2Winner];
      
      // Update Week 3 if we have PF result
      if (allResults[23]) {
        const pfResult = allResults[23].find(r => r.fixture?.name?.includes('Preliminary Final'));
        if (pfResult) {
          const pfWinner = pfResult.homeScore > pfResult.awayScore ? pfResult.homeTeam : pfResult.awayTeam;
          info.bracket.week3.game1.teams = [sf1Winner, pfWinner];
        }
      }
    }
  }
  
  return info;
}
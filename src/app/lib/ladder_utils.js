// app/lib/ladder_utils.js
import { USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { FIXTURES } from '@/app/lib/fixture_constants';

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

  // Process round 0 (pre-season) separately if scores exist
  if (allTeamScores[0]) {
    // Get top 4 teams from round 0
    const round0Scores = Object.entries(allTeamScores[0])
      .map(([userId, score]) => ({ userId, score }))
      .sort((a, b) => b.score - a.score);
    
    // Calculate average score for Round 0 (used for points against)
    const totalScores = round0Scores.reduce((sum, team) => sum + team.score, 0);
    const averageScore = Math.round(totalScores / round0Scores.length);
    
    // Top 4 teams get a win
    round0Scores.slice(0, 4).forEach(team => {
      const ladderEntry = ladder.find(entry => entry.userId === team.userId);
      if (ladderEntry) {
        ladderEntry.played += 1;
        ladderEntry.wins += 1;
        ladderEntry.pointsFor += team.score;
        ladderEntry.pointsAgainst += averageScore; // Use average score as points against
        ladderEntry.points += 4; // Win = 4 points
      }
    });
    
    // Bottom 4 teams get a loss
    round0Scores.slice(4).forEach(team => {
      const ladderEntry = ladder.find(entry => entry.userId === team.userId);
      if (ladderEntry) {
        ladderEntry.played += 1;
        ladderEntry.losses += 1;
        ladderEntry.pointsFor += team.score;
        ladderEntry.pointsAgainst += averageScore; // Use average score as points against
      }
    });
  }

  // Process regular season rounds (1-21)
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
 * Get final series fixtures based on ladder positions
 * @param {Array} ladder - Calculated ladder standings
 * @param {Number} finalRound - Finals round (22, 23, or 24)
 * @returns {Array} Finals fixtures for the specified round
 */
export function getFinalFixtures(ladder, finalRound) {
  if (finalRound === 22) {
    // Qualifying finals
    return [
      { home: ladder[0].userId, away: ladder[3].userId, name: 'Qualifying Final 1' },
      { home: ladder[1].userId, away: ladder[2].userId, name: 'Qualifying Final 2' }
    ];
  } else if (finalRound === 23) {
    // Preliminary final (Game 2 winner vs Game 1 loser)
    // This is a placeholder, actual teams would need to be determined from results
    return [
      { home: "TBD", away: "TBD", name: 'Preliminary Final' }
    ];
  } else if (finalRound === 24) {
    // Grand final
    return [
      { home: "TBD", away: "TBD", name: 'Grand Final' }
    ];
  }
  return [];
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
      return "Qualifying Finals";
    case 23:
      return "Preliminary Final";
    case 24:
      return "Grand Final";
    default:
      return `Round ${round}`;
  }
}
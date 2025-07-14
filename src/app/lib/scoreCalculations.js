import { USER_NAMES, POSITION_TYPES, BACKUP_POSITIONS } from './constants';
import { POSITIONS } from './scoring_rules';

// Define which positions are handled by which reserve
const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];

/**
 * Calculates score for a position with proper null checks.
 * @param {string} position - The position name (e.g., 'Full Forward', 'Bench').
 * @param {object} stats - Player stats object.
 * @param {string} [backupPosition=null] - The backup position for bench/reserve players.
 * @returns {{total: number, breakdown: string[]}} - Calculated score and breakdown.
 */
export const calculateScore = (position, stats, backupPosition = null) => {
  // Ensure stats exists
  if (!stats) return { total: 0, breakdown: [] };

  // Add default values for stats that might be missing
  const safeStats = {
    kicks: stats.kicks || 0,
    handballs: stats.handballs || 0,
    marks: stats.marks || 0,
    tackles: stats.tackles || 0,
    hitouts: stats.hitouts || 0,
    goals: stats.goals || 0,
    behinds: stats.behinds || 0,
    ...stats
  };

  // If it's a bench position, use the backup position for scoring
  if ((position === 'BENCH' || position.startsWith('RESERVE')) && backupPosition) {
    const backupPositionType = backupPosition.toUpperCase().replace(/\s+/g, '_');
    try {
      return POSITIONS[backupPositionType]?.calculation(safeStats) || { total: 0, breakdown: [] };
    } catch (error) {
      console.error(`Error calculating score for ${backupPositionType}:`, error);
      return { total: 0, breakdown: [] };
    }
  }

  // For regular positions, use the position's scoring rules
  const formattedPosition = position.toUpperCase().replace(/\s+/g, '_');
  try {
    return POSITIONS[formattedPosition]?.calculation(safeStats) || { total: 0, breakdown: [] };
  } catch (error) {
    console.error(`Error calculating score for ${formattedPosition}:`, error);
    return { total: 0, breakdown: [] };
  }
};

/**
 * Checks if a player's stats indicate they played.
 * @param {object} stats - Player stats object.
 * @returns {boolean} - True if player played, false otherwise.
 */
export const didPlayerPlay = (stats) => {
  if (!stats) return false;

  return (
    (stats.kicks && stats.kicks > 0) ||
    (stats.handballs && stats.handballs > 0) ||
    (stats.marks && stats.marks > 0) ||
    (stats.tackles && stats.tackles > 0) ||
    (stats.hitouts && stats.hitouts > 0) ||
    (stats.goals && stats.goals > 0) ||
    (stats.behinds && stats.behinds > 0)
  );
};

/**
 * Calculates all scores for a specific team, including substitutions.
 * This function is a backend-friendly version of getTeamScores from useResults.js.
 * @param {string} userId - The ID of the user.
 * @param {object} teamSelection - The team selection object for the user and round.
 * @param {object} playerStatsMap - A map of player names to their stats for the round.
 * @param {number} deadCertScore - The dead cert score for the user in this round.
 * @param {boolean} roundEndPassed - Whether the round has ended (for reserve substitutions).
 * @returns {object} - Calculated scores and details.
 */
export const calculateTeamScores = (
  userId,
  teamSelection,
  playerStatsMap,
  deadCertScore,
  roundEndPassed
) => {
  const userTeam = teamSelection.selectedPlayers || {};
  const debugData = []; // For debugging, can be removed later

  // Extract bench players with their backup positions
  const benchPlayers = Object.values(userTeam)
    .filter(data => data && data.position === 'Bench')
    .map(data => {
      if (!data || !data.playerName || !data.backupPosition) return null;

      const stats = playerStatsMap[data.playerName];
      const hasPlayed = didPlayerPlay(stats);

      if (!hasPlayed) return null; // Skip bench players who didn't play

      // Calculate the bench player's score in their backup position
      const backupPosType = data.backupPosition.toUpperCase().replace(/\s+/g, '_');
      const scoring = calculateScore(backupPosType, stats);

      return {
        position: data.position,
        playerName: data.playerName,
        backupPosition: data.backupPosition,
        stats,
        score: scoring?.total || 0,
        breakdown: scoring?.breakdown || '',
        hasPlayed
      };
    })
    .filter(Boolean); // Remove nulls

  // Extract reserve players
  const reservePlayers = Object.values(userTeam)
    .filter(data => data && data.position && data.position.startsWith('Reserve'))
    .map(data => {
      if (!data || !data.playerName) return null;

      const stats = playerStatsMap[data.playerName];
      const hasPlayed = didPlayerPlay(stats);

      if (!hasPlayed) return null; // Skip reserve players who didn't play

      // For reserves, associate them with their position type
      const isReserveA = data.position === 'Reserve A';
      const validPositions = isReserveA ? [...RESERVE_A_POSITIONS] : [...RESERVE_B_POSITIONS];

      // Add direct backup position if specified
      if (data.backupPosition) {
        validPositions.push(data.backupPosition);
      }

      return {
        position: data.position,
        playerName: data.playerName,
        backupPosition: data.backupPosition,
        stats,
        hasPlayed,
        validPositions,
        isReserveA
      };
    })
    .filter(Boolean);

  // Process main positions and apply substitutions
  const usedBenchPlayers = new Set();
  const usedReservePlayers = new Set();

  // First, calculate scores for all main positions with original scores
  const positionScores = POSITION_TYPES
    .filter(pos => !pos.includes('Bench') && !pos.includes('Reserve'))
    .map(position => {
      const playerData = userTeam.find(p => p.position === position);
      if (!playerData || !playerData.playerName) {
        return {
          position,
          playerName: null,
          score: 0,
          isBenchPlayer: false,
          noStats: true,
          hasPlayed: false
        };
      }

      const playerName = playerData.playerName;
      const stats = playerStatsMap[playerName];
      const hasPlayed = didPlayerPlay(stats);

      // Calculate original score
      const positionType = position.toUpperCase().replace(/\s+/g, '_');
      const scoring = calculateScore(positionType, stats);
      const originalScore = scoring?.total || 0;
      const breakdown = scoring?.breakdown || '';

      // Return position data with score
      return {
        position,
        playerName,
        originalPlayerName: playerName,
        player: stats,
        score: originalScore, // For now, set the score to the original score
        originalScore, // Keep track of the original score separately
        breakdown,
        hasPlayed,
        isBenchPlayer: false,
        noStats: !hasPlayed,
        team: stats?.team_name // Store original player's team
      };
    });

  // Step 1: Check if any bench player has a higher score than their backup position player
  for (const benchPlayer of benchPlayers) {
    const { backupPosition, playerName, score } = benchPlayer;

    // Find the position this bench player can back up
    const positionIndex = positionScores.findIndex(p => p.position === backupPosition);
    if (positionIndex === -1) continue;

    const positionPlayer = positionScores[positionIndex];
    const originalScore = positionPlayer.score;

    // Compare scores - if bench is higher, substitute
    if (score > originalScore) {
      debugData.push({
        message: `Bench player ${playerName} score (${score}) > ${positionPlayer.playerName} score (${originalScore}) for position ${backupPosition}`,
      });

      // Update the position with the bench player's score
      positionScores[positionIndex] = {
        ...positionPlayer,
        player: {
          ...benchPlayer.stats,
          originalTeam: positionPlayer.player?.team_name // Keep original player's team
        },
        playerName: benchPlayer.playerName,
        score: benchPlayer.score, // For total calculation
        originalScore, // Original player's score stays
        breakdown: benchPlayer.breakdown,
        isBenchPlayer: true,
        replacementType: 'Bench',
        team: positionPlayer.team // Preserve original player's team
      };

      // Mark this bench player as used
      usedBenchPlayers.add(playerName);
    }
  }

  // Step 2: Check if any main position player didn't play and needs a substitute
  // (only apply reserve substitutions if round has ended)
  if (roundEndPassed) {
    // console.log(`Round end passed for user ${userId}, applying reserve substitutions`);

    for (let i = 0; i < positionScores.length; i++) {
      const positionData = positionScores[i];

      // Skip positions where player played or already has a bench substitution
      if (positionData.hasPlayed || positionData.isBenchPlayer) {
        continue;
      }

      const position = positionData.position;
      const originalScore = positionData.score; // Original score (should be 0 for DNP players)

      // First try remaining bench players with matching backup
      const eligibleBench = benchPlayers
        .filter(b => !usedBenchPlayers.has(b.playerName) && b.backupPosition === position)
        .sort((a, b) => b.score - a.score);

      if (eligibleBench.length > 0) {
        const bestBench = eligibleBench[0];

        // Apply substitution
        positionScores[i] = {
          ...positionData,
          player: {
            ...bestBench.stats,
            originalTeam: positionData.player?.team_name // Keep original player's team
          },
          playerName: bestBench.playerName,
          score: bestBench.score, // For total calculation
          originalScore, // Original player's score stays
          breakdown: bestBench.breakdown,
          isBenchPlayer: true,
          replacementType: 'Bench',
          team: positionData.team // Preserve original player's team
        };

        // Mark as used
        usedBenchPlayers.add(bestBench.playerName);
        continue; // Move to next position
      }

      // If no bench player found, try reserve players
      const isReserveAPosition = RESERVE_A_POSITIONS.includes(position);
      const isReserveBPosition = RESERVE_B_POSITIONS.includes(position);

      // Find eligible reserves (not used and matches position type)
      const eligibleReserves = reservePlayers
        .filter(r => {
          // Skip already used reserves
          if (usedReservePlayers.has(r.playerName)) {
            return false;
          }

          // Check if this reserve covers this position
          if (r.backupPosition === position) {
            return true;
          }

          // Check position type match
          const matchesType = (r.isReserveA && isReserveAPosition) ||
                              (!r.isReserveA && isReserveBPosition);

          return matchesType;
        });

      if (eligibleReserves.length > 0) {
        // Calculate scores for each eligible reserve in this position
        const reserveScores = eligibleReserves.map(reserve => {
          const positionType = position.toUpperCase().replace(/\s+/g, '_');
          const scoring = calculateScore(positionType, reserve.stats);
          return {
            ...reserve,
            calculatedScore: scoring?.total || 0,
            breakdown: scoring?.breakdown || '',
            // Priority: direct backup > position type match
            priority: reserve.backupPosition === position ? 2 : 1
          };
        });

        // Sort by priority first, then score
        reserveScores.sort((a, b) => {
          if (a.priority !== b.priority) return b.priority - a.priority;
          return b.calculatedScore - a.calculatedScore;
        });

        // Use best reserve
        if (reserveScores.length > 0) {
          const bestReserve = reserveScores[0];

          // Apply substitution
          positionScores[i] = {
            ...positionData,
            player: {
              ...bestReserve.stats,
              originalTeam: positionData.player?.team_name // Keep original player's team
            },
            playerName: bestReserve.playerName,
            score: bestReserve.calculatedScore, // For total calculation
            originalScore, // Original player's score stays
            breakdown: bestReserve.breakdown,
            isBenchPlayer: true,
            replacementType: bestReserve.position,
            team: positionData.team // Preserve original player's team
          };

          // Mark as used
          usedReservePlayers.add(bestReserve.playerName);
        }
      }
    }
  }

  // Calculate total score (using the substituted scores for the total)
  const totalScore = positionScores.reduce((total, pos) => total + pos.score, 0);
  const finalScore = totalScore + deadCertScore;

  return {
    userId,
    totalScore: totalScore, // This is the team score before dead certs
    deadCertScore: deadCertScore,
    finalScore: finalScore,
    positionScores: positionScores,
    benchScores: benchPlayers.filter(b => !usedBenchPlayers.has(b.playerName)), // Bench players not used for substitution
    reserveScores: reservePlayers.filter(r => !usedReservePlayers.has(r.playerName)), // Reserve players not used for substitution
    substitutionsEnabled: {
      bench: true, // Bench players can always be substituted
      reserve: roundEndPassed // Reserve A/B only when round has ended
    },
    debugData // Include debug data for inspection
  };
};

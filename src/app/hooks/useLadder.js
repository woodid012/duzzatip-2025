'use client'

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { calculateLadder, isFinalRound, getFinalRoundName } from '@/app/lib/ladder_utils';
import { USER_NAMES, POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';
import { POSITIONS } from '@/app/lib/scoring_rules';

export default function useLadder() {
  const { currentRound, changeRound } = useAppContext();
  
  const [ladder, setLadder] = useState([]);
  const [allTeamScores, setAllTeamScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load round results for each round up to the current one
  useEffect(() => {
    const fetchAllRoundScores = async () => {
      setLoading(true);
      
      try {
        const scores = {};
        
        // Load results for all rounds up to current
        for (let round = 0; round <= currentRound; round++) {
          const results = await fetchRoundScores(round);
          if (results) {
            scores[round] = results;
          }
        }
        
        setAllTeamScores(scores);
        
        // Calculate ladder based on all results
        const calculatedLadder = calculateLadder(scores, currentRound);
        setLadder(calculatedLadder);
      } catch (err) {
        console.error('Error fetching scores:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchAllRoundScores();
  }, [currentRound]);

  // Helper functions from useResults.js that we need to reimplement for correct substitution logic
  const didPlayerPlay = (stats) => {
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

  const calculateScore = (position, stats, backupPosition = null) => {
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
    const formattedPosition = position.replace(/\s+/g, '_');
    try {
      return POSITIONS[formattedPosition]?.calculation(safeStats) || { total: 0, breakdown: [] };
    } catch (error) {
      console.error(`Error calculating score for ${formattedPosition}:`, error);
      return { total: 0, breakdown: [] };
    }
  };

  // Define which positions are handled by which reserve
  const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
  const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];

  // Fetch scores for a specific round
  const fetchRoundScores = async (round) => {
    try {
      // Initialize scores object
      const scores = {};
      
      // First, get team selection data for all users
      const teamSelectRes = await fetch(`/api/team-selection?round=${round}`);
      const teamSelection = teamSelectRes.ok ? await teamSelectRes.json() : {};
      
      // Then, get stats for all players in this round
      const gameStatsRes = await fetch(`/api/all-stats?round=${round}`);
      const gameStats = gameStatsRes.ok ? await gameStatsRes.json() : [];
      
      // Check if round has ended (needed for reserve substitutions)
      const roundInfoRes = await fetch(`/api/round-info?round=${round}`);
      const roundInfo = roundInfoRes.ok ? await roundInfoRes.json() : {};
      const roundEndPassed = roundInfo.roundEndTime ? new Date() > new Date(roundInfo.roundEndTime) : false;
      
      // Process each user's team
      for (const userId of Object.keys(USER_NAMES)) {
        try {
          const userTeam = teamSelection[userId] || {};
          
          // Create player stats mapping for easier access
          const playerStats = {};
          Object.entries(userTeam).forEach(([position, data]) => {
            if (!data || !data.player_name) return;
            
            const playerStat = gameStats.find(stat => stat.player_name === data.player_name);
            if (playerStat) {
              playerStats[data.player_name] = playerStat;
            }
          });
          
          // Extract bench players with their backup positions
          const benchPlayers = Object.entries(userTeam)
            .filter(([pos]) => pos === 'Bench')
            .map(([pos, data]) => {
              if (!data.player_name || !data.backup_position) return null;
              
              const stats = playerStats[data.player_name];
              // Check if bench player played
              const hasPlayed = didPlayerPlay(stats);
              
              if (!hasPlayed) return null; // Skip bench players who didn't play
              
              // Calculate the bench player's score in their backup position
              const backupPosType = data.backup_position.toUpperCase().replace(/\s+/g, '_');
              const scoring = calculateScore(backupPosType, stats);
              
              return {
                position: pos,
                playerName: data.player_name,
                backupPosition: data.backup_position,
                stats,
                score: scoring?.total || 0,
                breakdown: scoring?.breakdown || '',
                hasPlayed
              };
            })
            .filter(Boolean); // Remove nulls
          
          // Extract reserve players
          const reservePlayers = Object.entries(userTeam)
            .filter(([pos]) => pos.startsWith('Reserve'))
            .map(([pos, data]) => {
              if (!data.player_name) return null;
              
              const stats = playerStats[data.player_name];
              const hasPlayed = didPlayerPlay(stats);
              
              if (!hasPlayed) return null; // Skip reserve players who didn't play
              
              // For reserves, associate them with their position type
              const isReserveA = pos === 'Reserve A';
              const validPositions = isReserveA ? RESERVE_A_POSITIONS : RESERVE_B_POSITIONS;
              
              // Add direct backup position if specified
              if (data.backup_position) {
                validPositions.push(data.backup_position);
              }
              
              return {
                position: pos,
                playerName: data.player_name,
                backupPosition: data.backup_position,
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
              const playerData = userTeam[position];
              if (!playerData || !playerData.player_name) {
                return {
                  position,
                  playerName: null,
                  score: 0,
                  isBenchPlayer: false
                };
              }
              
              const playerName = playerData.player_name;
              const stats = playerStats[playerName];
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
                noStats: !hasPlayed
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
              // Update the position with the bench player's score
              positionScores[positionIndex] = {
                ...positionPlayer,
                player: benchPlayer.stats,
                playerName: benchPlayer.playerName,
                score: benchPlayer.score, // For total calculation
                originalScore, // Original player's score stays
                breakdown: benchPlayer.breakdown,
                isBenchPlayer: true,
                replacementType: 'Bench'
              };
              
              // Mark this bench player as used
              usedBenchPlayers.add(playerName);
            }
          }
          
          // Step 2: Check if any main position player didn't play and needs a substitute
          // (only apply reserve substitutions if round has ended)
          if (roundEndPassed) {
            for (let i = 0; i < positionScores.length; i++) {
              const positionData = positionScores[i];
              
              // Skip positions where player played or already has a bench substitution
              if (positionData.hasPlayed || positionData.isBenchPlayer) continue;
              
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
                  player: bestBench.stats,
                  playerName: bestBench.playerName,
                  score: bestBench.score, // For total calculation
                  originalScore, // Original player's score stays
                  breakdown: bestBench.breakdown,
                  isBenchPlayer: true,
                  replacementType: 'Bench'
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
                  if (usedReservePlayers.has(r.playerName)) return false;
                  
                  // Check if this reserve covers this position
                  if (r.backupPosition === position) return true;
                  
                  // Check position type match
                  return (r.isReserveA && isReserveAPosition) || 
                        (!r.isReserveA && isReserveBPosition);
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
                    player: bestReserve.stats,
                    playerName: bestReserve.playerName,
                    score: bestReserve.calculatedScore, // For total calculation
                    originalScore, // Original player's score stays
                    breakdown: bestReserve.breakdown,
                    isBenchPlayer: true,
                    replacementType: bestReserve.position
                  };
                  
                  // Mark as used
                  usedReservePlayers.add(bestReserve.playerName);
                }
              }
            }
          }
          
          // Calculate total score with substitutions
          const teamScore = positionScores.reduce((total, pos) => total + pos.score, 0);
          
          // Get dead cert score
          let deadCertScore = 0;
          
          // Get tipping results to include dead cert scores
          const tippingRes = await fetch(`/api/tipping-results?round=${round}&userId=${userId}`);
          
          if (tippingRes.ok) {
            const tippingData = await tippingRes.json();
            deadCertScore = tippingData.deadCertScore || 0;
          }
          
          // Calculate final score
          const finalScore = teamScore + deadCertScore;
          
          // Add to scores
          scores[userId] = finalScore;
          
        } catch (userError) {
          console.warn(`Could not fetch scores for user ${userId}, round ${round}:`, userError);
          // Default to 0 if there's an error
          scores[userId] = 0;
        }
      }
      
      return Object.keys(scores).length > 0 ? scores : null;
    } catch (err) {
      console.error(`Error fetching round ${round} scores:`, err);
      return null;
    }
  };

  // Get finals fixtures based on ladder positions
  const getFinalsFixtures = (finalRound) => {
    if (finalRound === 22) {
      // Qualifying finals
      return [
        { home: ladder[0]?.userId, away: ladder[3]?.userId, name: 'Qualifying Final 1' },
        { home: ladder[1]?.userId, away: ladder[2]?.userId, name: 'Qualifying Final 2' }
      ];
    } else if (finalRound === 23) {
      // Preliminary final
      return [
        { home: "QF2 Winner", away: "QF1 Loser", name: 'Preliminary Final' }
      ];
    } else if (finalRound === 24) {
      // Grand final
      return [
        { home: "QF1 Winner", away: "PF Winner", name: 'Grand Final' }
      ];
    }
    return [];
  };

  return {
    // State
    ladder,
    allTeamScores,
    loading,
    error,
    currentRound,
    
    // Actions
    getFinalsFixtures,
    changeRound,
    fetchRoundScores,
    
    // Helper functions
    isFinalRound,
    getFinalRoundName
  };
}
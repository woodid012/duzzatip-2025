'use client'

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR, POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';
import { POSITIONS } from '@/app/lib/scoring_rules';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

export default function useResults() {
  const { currentRound, changeRound } = useAppContext();
  
  const [teams, setTeams] = useState({});
  const [playerStats, setPlayerStats] = useState({});
  const [deadCertScores, setDeadCertScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [roundEndPassed, setRoundEndPassed] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);

  // Define which positions are handled by which reserve
  const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
  const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];

  // Load data when round changes
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch round info to determine if round has ended
        let roundInfoResponse;
        try {
          roundInfoResponse = await fetch(`/api/round-info?round=${currentRound}`);
          if (roundInfoResponse.ok) {
            const roundInfoData = await roundInfoResponse.json();
            // Check if round end has passed
            if (roundInfoData.roundEndTime) {
              const roundEndDate = new Date(roundInfoData.roundEndTime);
              const now = new Date();
              setRoundEndPassed(now > roundEndDate);
            }
          }
        } catch (err) {
          console.warn('Could not fetch round info:', err);
          // Use simple calculation for round end (3 days after start)
          const now = new Date();
          const threeHoursAgo = new Date(now.setHours(now.getHours() - 3));
          setRoundEndPassed(currentRound >= 1); // Only enable for round 1 and above
        }
        
        // Fetch teams and player stats
        const teamsRes = await fetch(`/api/team-selection?round=${currentRound}`);
        if (!teamsRes.ok) throw new Error('Failed to fetch teams');
        const teamsData = await teamsRes.json();
        setTeams(teamsData);
    
        // Fetch dead cert scores for all users (1-8)
        const deadCertPromises = Array.from({ length: 8 }, (_, i) => i + 1).map(userId => 
          fetch(`/api/tipping-results?round=${currentRound}&userId=${userId}`)
            .then(res => res.json())
            .catch(() => ({ deadCertScore: 0 })) // Default value if fetch fails
        );
        const deadCertResults = await Promise.all(deadCertPromises);
        const deadCertMap = {};
        deadCertResults.forEach((result, index) => {
          const userId = index + 1;
          deadCertMap[userId] = result.deadCertScore || 0;
        });
        setDeadCertScores(deadCertMap);

        // Fetch player stats for each team
        const allStats = {};
        for (const [userId, team] of Object.entries(teamsData)) {
          // Collect all player names for this team
          const playerNames = Object.values(team)
            .map(data => data.player_name)
            .filter(Boolean); // Remove any undefined/null values
    
          if (playerNames.length === 0) continue;

          // Make a single API call for all players in the team
          const res = await fetch(`/api/player-stats?round=${currentRound}&players=${encodeURIComponent(playerNames.join(','))}`);
          if (!res.ok) throw new Error('Failed to fetch player stats');
          const statsData = await res.json();
    
          // Process the stats for each player
          const playerStats = {};
          for (const [position, data] of Object.entries(team)) {
            const playerName = data.player_name;
            if (!playerName) continue;
            
            const stats = statsData[playerName];
            const positionType = position.toUpperCase().replace(/\s+/g, '_');
            
            const scoring = calculateScore(positionType, stats, data.backup_position);
            
            // Check if player has any stats (if they played)
            const hasPlayed = stats && (
              stats.kicks > 0 || 
              stats.handballs > 0 || 
              stats.marks > 0 || 
              stats.tackles > 0 || 
              stats.hitouts > 0 || 
              stats.goals > 0 || 
              stats.behinds > 0
            );
            
            playerStats[playerName] = {
              ...stats,
              scoring,
              backup_position: data.backup_position,
              original_position: position,
              hasPlayed: hasPlayed
            };
          }
          allStats[userId] = playerStats;
        }
        setPlayerStats(allStats);
      } catch (err) {
        console.error('Error fetching results data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
    // For development purpose - force enable substitutions for testing
    // Comment this out in production
    // setRoundEndPassed(true);
  }, [currentRound]);

  // Calculate score for a position
  const calculateScore = (position, stats, backupPosition = null) => {
    if (!stats) return { total: 0, breakdown: [] };
    
    // If it's a bench position, use the backup position for scoring
    if ((position === 'BENCH' || position.startsWith('RESERVE')) && backupPosition) {
      const backupPositionType = backupPosition.toUpperCase().replace(/\s+/g, '_');
      return POSITIONS[backupPositionType]?.calculation(stats) || { total: 0, breakdown: [] };
    }

    // For regular positions, use the position's scoring rules
    const formattedPosition = position.replace(/\s+/g, '_');
    return POSITIONS[formattedPosition]?.calculation(stats) || { total: 0, breakdown: [] };
  };

  // Function to check if a player's stats indicate they played
  const didPlayerPlay = (stats) => {
    if (!stats) return false;
    
    return (
      stats.kicks > 0 || 
      stats.handballs > 0 || 
      stats.marks > 0 || 
      stats.tackles > 0 || 
      stats.hitouts > 0 || 
      stats.goals > 0 || 
      stats.behinds > 0
    );
  };

  // Calculate all team scores to determine highest and lowest
  const calculateAllTeamScores = useCallback(() => {
    return Object.entries(teams).map(([userId, team]) => {
      // Use the same logic as getTeamScores but just return the final score
      const teamScoreData = getTeamScores(userId);
      return { 
        userId, 
        totalScore: teamScoreData.finalScore 
      };
    });
  }, [teams]);

  // Get scores for a specific team - memoize with useCallback to prevent recreation on each render
  const getTeamScores = useCallback((userId) => {
    const userTeam = teams[userId] || {};
    
    // Get all bench and reserve players
    const reservePlayers = Object.entries(userTeam)
      .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
      .map(([pos, data]) => {
        if (!data.player_name) return null;
        
        return {
          ...playerStats[userId]?.[data.player_name],
          original_position: pos,
          backup_position: data.backup_position,
          player_name: data.player_name
        };
      })
      .filter(Boolean);

    const mainTeamPositions = POSITION_TYPES.filter(pos => 
      !pos.includes('Bench') && !pos.includes('Reserve'));
    
    // Create debug info for specific players we want to track, but don't set state directly
    const debugData = [];
    
    // Identify positions that need replacements
    const positionsNeedingReplacement = [];
    const workingPositionScores = mainTeamPositions.map(position => {
      const playerData = Object.entries(userTeam).find(([pos]) => pos === position)?.[1];
      if (!playerData) return { position, player: null, score: 0, isBenchPlayer: false };
      
      const mainPlayerStats = playerStats[userId]?.[playerData.player_name];
      
      // Check if the main player played
      if (mainPlayerStats && didPlayerPlay(mainPlayerStats)) {
        return {
          position,
          player: mainPlayerStats,
          playerName: playerData.player_name,
          score: mainPlayerStats.scoring?.total || 0,
          breakdown: mainPlayerStats.scoring?.breakdown || '',
          originalPlayerName: playerData.player_name,
          isBenchPlayer: false
        };
      }
      
      // Track for debugging
      if (position === 'Ruck') {
        debugData.push({
          position,
          playerName: playerData.player_name,
          hasPlayed: didPlayerPlay(mainPlayerStats),
          stats: mainPlayerStats
        });
      }
      
      // Only add to replacement list if substitutions are enabled
      // (round end has passed or we're past round 1)
      if (roundEndPassed || currentRound > 1) {
        // If main player didn't play, this position needs replacement
        positionsNeedingReplacement.push({
          position,
          playerData,
          isReserveAPosition: RESERVE_A_POSITIONS.includes(position),
          isReserveBPosition: RESERVE_B_POSITIONS.includes(position)
        });
      }
      
      // Return a placeholder that will be updated
      return {
        position,
        player: mainPlayerStats,
        playerName: playerData.player_name,
        score: 0,
        breakdown: '',
        originalPlayerName: playerData.player_name,
        isBenchPlayer: false,
        noStats: true,
        needsReplacement: roundEndPassed || currentRound > 1 // Only mark as needing replacement if substitutions are enabled
      };
    });
    
    // If we have positions needing replacement AND substitutions are enabled
    if (positionsNeedingReplacement.length > 0 && (roundEndPassed || currentRound > 1)) {
      // Add debug info for bench players
      reservePlayers.forEach(player => {
        if (player && (player.original_position === 'Bench' || player.backup_position === 'Ruck')) {
          debugData.push({
            position: player.original_position,
            playerName: player.player_name,
            backup: player.backup_position,
            hasPlayed: didPlayerPlay(player),
            score: player.scoring?.total || 0
          });
        }
      });
      
      // Calculate potential scores for each position-reserve combo
      const scoringPotentials = [];
      
      positionsNeedingReplacement.forEach(posInfo => {
        // For debugging Ruck position
        if (posInfo.position === 'Ruck') {
          debugData.push({
            message: 'Ruck position needs replacement',
            availableReserves: reservePlayers
              .filter(didPlayerPlay)
              .map(r => ({
                name: r.player_name,
                position: r.original_position,
                backup: r.backup_position,
                score: r.scoring?.total || 0
              }))
          });
        }
        
        // Calculate scoring potential for each reserve in this position
        reservePlayers.forEach(reserve => {
          if (!reserve || !didPlayerPlay(reserve)) return; // Skip reserves that didn't play
          
          // Calculate what score this reserve would get in this position
          const positionType = posInfo.position.toUpperCase().replace(/\s+/g, '_');
          // Use the player's real position scoring if available
          const calculationFunc = POSITIONS[positionType]?.calculation;
          
          if (!calculationFunc) {
            console.warn(`No scoring calculation found for position: ${posInfo.position}`);
            return;
          }
          
          const potentialScore = calculationFunc(reserve)?.total || 0;
          
          // Calculate priority score (for sorting)
          // Direct backup position gets highest priority
          let priority = 0;
          if (reserve.backup_position === posInfo.position) {
            priority = 3;
          } else if (
            (reserve.original_position === 'Reserve A' && posInfo.isReserveAPosition) ||
            (reserve.original_position === 'Reserve B' && posInfo.isReserveBPosition)
          ) {
            priority = 2;
          } else if (reserve.original_position.startsWith('Reserve')) {
            priority = 1;
          }
          
          scoringPotentials.push({
            position: posInfo.position,
            reserve,
            score: potentialScore,
            priority,
            // Generate a composite score for sorting (priority * 1000 + score)
            sortScore: (priority * 1000) + potentialScore
          });
          
          // Add debug info for Ruck position
          if (posInfo.position === 'Ruck') {
            debugData.push({
              potential: `${reserve.player_name} (${reserve.original_position}) as ${posInfo.position}`,
              score: potentialScore,
              priority,
              sortScore: (priority * 1000) + potentialScore
            });
          }
        });
      });
      
      // Sort by priority first, then by score
      scoringPotentials.sort((a, b) => b.sortScore - a.sortScore);
      
      // Keep track of which positions and reserves have been used
      const assignedPositions = new Set();
      const usedReserves = new Set();
      
      // Add debug info for sorted potentials for Ruck position
      debugData.push({
        message: 'Sorted scoring potentials',
        potentials: scoringPotentials
          .filter(p => p.position === 'Ruck')
          .map(p => ({
            player: p.reserve.player_name,
            position: p.position,
            score: p.score,
            sortScore: p.sortScore
          }))
      });
      
      // Assign reserves to positions based on sorted potential scores
      scoringPotentials.forEach(potential => {
        // Skip if this position already has a replacement or this reserve is already used
        if (assignedPositions.has(potential.position) || 
            usedReserves.has(potential.reserve.player_name)) {
          return;
        }
        
        // Find the position in our working scores array
        const positionIndex = workingPositionScores.findIndex(p => 
          p.position === potential.position && p.needsReplacement);
        
        if (positionIndex !== -1) {
          // Calculate scoring for this position
          const positionType = potential.position.toUpperCase().replace(/\s+/g, '_');
          const scoring = POSITIONS[positionType]?.calculation(potential.reserve);
          
          // For debugging Ruck position assignments
          if (potential.position === 'Ruck') {
            debugData.push({
              message: `Assigning ${potential.reserve.player_name} to ${potential.position}`,
              score: scoring?.total || 0,
              breakdown: scoring?.breakdown || ''
            });
          }
          
          // Update the position with the replacement
          workingPositionScores[positionIndex] = {
            position: potential.position,
            player: potential.reserve,
            playerName: potential.reserve.player_name,
            score: scoring?.total || 0,
            breakdown: scoring?.breakdown || '',
            originalPlayerName: workingPositionScores[positionIndex].originalPlayerName,
            isBenchPlayer: true,
            replacementType: potential.reserve.original_position
          };
          
          // Mark this position and reserve as used
          assignedPositions.add(potential.position);
          usedReserves.add(potential.reserve.player_name);
        }
      });
    }
    
    // Our final position scores
    const positionScores = workingPositionScores;

    // Calculate bench/reserve scores
    const benchScores = Object.entries(userTeam)
      .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
      .map(([position, data]) => {
        if (!data.player_name) return null;
        
        const reserveStats = playerStats[userId]?.[data.player_name];
        const backupPosition = data.backup_position;
        
        // Check if this reserve is being used to replace a player
        const replacedPosition = positionScores.find(pos => 
          pos.isBenchPlayer && pos.playerName === data.player_name
        );
        
        const isBeingUsed = !!replacedPosition;
        
        return {
          position,
          backupPosition,
          player: reserveStats,
          playerName: data.player_name,
          score: reserveStats?.scoring?.total || 0,
          breakdown: reserveStats?.scoring?.breakdown || '',
          isBeingUsed,
          replacingPosition: isBeingUsed ? replacedPosition.position : null,
          replacingPlayerName: isBeingUsed ? replacedPosition.originalPlayerName : null,
          didPlay: didPlayerPlay(reserveStats)
        };
      })
      .filter(Boolean);

    // Calculate total score
    const totalScore = positionScores.reduce((total, pos) => total + pos.score, 0);
    const deadCertScore = deadCertScores[userId] || 0;
    const finalScore = totalScore + deadCertScore;

    return {
      userId,
      totalScore,
      deadCertScore,
      finalScore,
      positionScores,
      benchScores,
      substitutionsEnabled: roundEndPassed || currentRound > 1,
      debugInfo: debugData.length > 0 ? debugData : null  // Instead of setting state, return debug data
    };
  }, [teams, playerStats, deadCertScores, roundEndPassed, currentRound]);

  // Use a separate effect to handle debug info updates
  useEffect(() => {
    // Update debug info when needed, but only after initial render
    // This prevents infinite re-renders
    if (!loading && playerStats && Object.keys(playerStats).length > 0) {
      // You could call getTeamScores for a specific user here to debug
      const firstUserId = Object.keys(teams)[0];
      if (firstUserId) {
        const teamScores = getTeamScores(firstUserId);
        if (teamScores.debugInfo) {
          setDebugInfo(teamScores.debugInfo);
        }
      }
    }
  }, [loading, playerStats, teams, getTeamScores]);

  return {
    // State
    currentRound,
    teams,
    playerStats,
    deadCertScores,
    loading,
    error,
    roundEndPassed,
    debugInfo,
    
    // Actions
    changeRound,
    calculateAllTeamScores,
    getTeamScores
  };
}
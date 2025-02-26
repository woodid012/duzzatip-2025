'use client'

import { useState, useEffect } from 'react';
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

  // Load data when round changes
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch teams and player stats
        const teamsRes = await fetch(`/api/team-selection?round=${currentRound}`);
        if (!teamsRes.ok) throw new Error('Failed to fetch teams');
        const teamsData = await teamsRes.json();
        setTeams(teamsData);
    
        // Fetch dead cert scores for all users (1-8)
        const deadCertPromises = Array.from({ length: 8 }, (_, i) => i + 1).map(userId => 
          fetch(`/api/tipping-results?round=${currentRound}&userId=${userId}`)
            .then(res => res.json())
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
            playerStats[playerName] = {
              ...stats,
              scoring,
              backup_position: data.backup_position,
              original_position: position
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

  // Function to check if bench player should replace main team player
  const getBestPlayerForPosition = (mainPlayer, benchPlayers, position) => {
    if (!mainPlayer || !benchPlayers || benchPlayers.length === 0) return mainPlayer;

    const mainScore = mainPlayer?.scoring?.total || 0;
    let bestPlayer = mainPlayer;
    let bestScore = mainScore;

    benchPlayers.forEach(benchPlayer => {
      if (benchPlayer?.backup_position === position) {
        const benchScore = benchPlayer?.scoring?.total || 0;
        if (benchScore > bestScore) {
          bestPlayer = benchPlayer;
          bestScore = benchScore;
        }
      }
    });

    return bestPlayer;
  };

  // Calculate all team scores to determine highest and lowest
  const calculateAllTeamScores = () => {
    return Object.entries(teams).map(([userId, team]) => {
      const userTeam = teams[userId] || {};
      const benchPlayers = Object.entries(userTeam)
        .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
        .map(([_, data]) => playerStats[userId]?.[data.player_name])
        .filter(Boolean);

      const mainTeamPositions = POSITION_TYPES.filter(pos => 
        !pos.includes('Bench') && !pos.includes('Reserve'));
      
      const totalScore = mainTeamPositions.reduce((total, position) => {
        const playerData = Object.entries(userTeam).find(([pos]) => pos === position)?.[1];
        if (!playerData) return total;
        
        const mainPlayerStats = playerStats[userId]?.[playerData.player_name];
        const bestPlayer = getBestPlayerForPosition(mainPlayerStats, benchPlayers, position);
        
        return total + (bestPlayer?.scoring?.total || 0);
      }, 0);

      const deadCertsScore = deadCertScores[userId] || 0;
      return { userId, totalScore: totalScore + deadCertsScore };
    });
  };

  // Get scores for a specific team
  const getTeamScores = (userId) => {
    const userTeam = teams[userId] || {};
    const benchPlayers = Object.entries(userTeam)
      .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
      .map(([_, data]) => playerStats[userId]?.[data.player_name])
      .filter(Boolean);

    const mainTeamPositions = POSITION_TYPES.filter(pos => 
      !pos.includes('Bench') && !pos.includes('Reserve'));
    
    // Calculate scores for main team positions
    const positionScores = mainTeamPositions.map(position => {
      const playerData = Object.entries(userTeam).find(([pos]) => pos === position)?.[1];
      if (!playerData) return { position, player: null, score: 0, isBenchPlayer: false };
      
      const mainPlayerStats = playerStats[userId]?.[playerData.player_name];
      const bestPlayer = getBestPlayerForPosition(mainPlayerStats, benchPlayers, position);
      
      return {
        position,
        player: bestPlayer,
        playerName: bestPlayer?.player_name || playerData.player_name,
        score: bestPlayer?.scoring?.total || 0,
        breakdown: bestPlayer?.scoring?.breakdown || '',
        originalPlayerName: playerData.player_name,
        isBenchPlayer: bestPlayer !== mainPlayerStats
      };
    });

    // Calculate bench scores
    const benchScores = Object.entries(userTeam)
      .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
      .map(([position, data]) => {
        const benchStats = playerStats[userId]?.[data.player_name];
        const backupPosition = data.backup_position;
        
        const replacedPosition = mainTeamPositions.find(pos => {
          const posData = userTeam[pos];
          const posStats = playerStats[userId]?.[posData?.player_name];
          const bestPlayer = getBestPlayerForPosition(posStats, benchPlayers, pos);
          return bestPlayer?.player_name === data.player_name;
        });

        const isBeingUsed = !!replacedPosition;
        const originalPlayerData = isBeingUsed ? userTeam[replacedPosition] : null;
        
        return {
          position,
          backupPosition,
          player: benchStats,
          playerName: data.player_name,
          score: benchStats?.scoring?.total || 0,
          breakdown: benchStats?.scoring?.breakdown || '',
          isBeingUsed,
          replacingPosition: replacedPosition,
          replacingPlayerName: originalPlayerData?.player_name
        };
      });

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
      benchScores
    };
  };

  return {
    // State
    currentRound,
    teams,
    playerStats,
    deadCertScores,
    loading,
    error,
    
    // Actions
    changeRound,
    calculateAllTeamScores,
    getTeamScores
  };
}

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppContext } from '@/app/context/AppContext';

// Optimized results hook with better data flow and caching
export default function useOptimizedResults() {
  const { currentRound, roundInfo } = useAppContext();
  const [displayRound, setDisplayRound] = useState(null);
  const [data, setData] = useState({
    teams: {},
    playerStats: {},
    deadCertScores: {},
    fixtures: [],
    isRoundComplete: false
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Cache for round data to prevent refetching
  const [roundCache] = useState(new Map());

  // Initialize round from context
  useEffect(() => {
    if (currentRound !== undefined && displayRound === null) {
      setDisplayRound(currentRound);
    }
  }, [currentRound, displayRound]);

  // Load all round data in parallel when round changes
  const loadRoundData = useCallback(async (round) => {
    if (round === null) return;

    // Check cache first
    if (roundCache.has(round)) {
      setData(roundCache.get(round));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Parallel API calls for better performance
      const [teamsRes, squadRes, fixturesRes] = await Promise.all([
        fetch(`/api/team-selection?round=${round}`),
        fetch('/api/squads'),
        fetch(`/api/fixtures?round=${round}`) // Assuming you have this endpoint
      ]);

      if (!teamsRes.ok) throw new Error('Failed to load teams');
      if (!squadRes.ok) throw new Error('Failed to load squads');

      const teams = await teamsRes.json();
      const squads = await squadRes.json();
      const fixtures = fixturesRes.ok ? await fixturesRes.json() : [];

      // Get all unique player names across all teams
      const allPlayerNames = new Set();
      Object.values(teams).forEach(team => {
        Object.values(team).forEach(position => {
          if (position?.player_name) {
            allPlayerNames.add(position.player_name);
          }
        });
      });

      // Single API call for all player stats
      const playerStatsRes = await fetch(
        `/api/player-stats?round=${round}&players=${Array.from(allPlayerNames).join(',')}`
      );
      const playerStats = playerStatsRes.ok ? await playerStatsRes.json() : {};

      // Batch call for all dead cert scores
      const userIds = Object.keys(teams);
      const deadCertPromises = userIds.map(userId => 
        fetch(`/api/tipping-results?round=${round}&userId=${userId}`)
          .then(res => res.ok ? res.json() : { deadCertScore: 0 })
          .catch(() => ({ deadCertScore: 0 }))
      );
      const deadCertResults = await Promise.all(deadCertPromises);
      
      const deadCertScores = {};
      deadCertResults.forEach((result, index) => {
        deadCertScores[userIds[index]] = result.deadCertScore || 0;
      });

      // Determine if round is complete
      const isRoundComplete = round < currentRound || 
        (roundInfo?.isRoundEnded && round === currentRound);

      const roundData = {
        teams,
        playerStats,
        deadCertScores,
        fixtures,
        isRoundComplete
      };

      // Cache the data
      roundCache.set(round, roundData);
      setData(roundData);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentRound, roundInfo, roundCache]);

  // Load data when round changes
  useEffect(() => {
    loadRoundData(displayRound);
  }, [displayRound, loadRoundData]);

  // Memoized team score calculations
  const teamScores = useMemo(() => {
    if (loading || !data.teams) return {};

    const scores = {};
    Object.keys(data.teams).forEach(userId => {
      scores[userId] = calculateTeamScore(
        userId, 
        data.teams[userId], 
        data.playerStats, 
        data.deadCertScores[userId] || 0,
        data.isRoundComplete
      );
    });
    return scores;
  }, [data, loading]);

  const changeRound = useCallback((newRound) => {
    if (newRound !== displayRound) {
      setDisplayRound(newRound);
    }
  }, [displayRound]);

  return {
    displayRound,
    teamScores,
    fixtures: data.fixtures,
    loading,
    error,
    isRoundComplete: data.isRoundComplete,
    changeRound
  };
}

// Simplified team score calculation (extract core logic)
function calculateTeamScore(userId, team, allPlayerStats, deadCertScore, isRoundComplete) {
  // Simplified scoring logic here - extract from existing useResults
  // This would contain the core scoring algorithm without the complex state management
  
  return {
    userId,
    totalScore: 0, // Calculate based on team composition
    deadCertScore,
    finalScore: 0, // totalScore + deadCertScore
    positionScores: [],
    benchScores: []
  };
}
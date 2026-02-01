'use client'

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { USER_NAMES } from '@/app/lib/constants';

export default function useLadder() {
  const { currentRound, changeRound, selectedYear } = useAppContext();
  
  const [ladder, setLadder] = useState([]);
  const [currentRoundResults, setCurrentRoundResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dataSource, setDataSource] = useState('unknown');

  // Define fetchLadderData function that can be reused
  const fetchLadderData = useCallback(async () => {
    if (currentRound === undefined || currentRound === null) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log(`Fetching ladder data for round ${currentRound}`);
      
      // Get ladder data (now includes auto-storage logic)
      const ladderResponse = await fetch(`/api/ladder?round=${currentRound}&year=${selectedYear}`);
      
      if (!ladderResponse.ok) {
        throw new Error('Failed to fetch ladder data');
      }
      
      const ladderData = await ladderResponse.json();
      
      if (ladderData.standings && ladderData.standings.length > 0) {
        console.log(`Loaded ladder for round ${currentRound}`, {
          fromCache: ladderData.fromCache,
          calculated: ladderData.calculated
        });
        
        setLadder(ladderData.standings);
        setLastUpdated(ladderData.lastUpdated ? new Date(ladderData.lastUpdated) : null);
        setDataSource(ladderData.fromCache ? 'cached' : 'live');
      } else {
        console.warn(`No ladder data available for round ${currentRound}`);
        setLadder([]);
        setDataSource('empty');
      }
      
      // Also get the current round results for context
      await fetchCurrentRoundResults();
      
    } catch (err) {
      console.error('Error fetching ladder data:', err);
      setError(err.message);
      // Set empty ladder as fallback
      setLadder(Object.entries(USER_NAMES).map(([userId, userName]) => ({
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
      })));
    } finally {
      setLoading(false);
    }
  }, [currentRound]);

  // Load ladder data for the current round
  useEffect(() => {
    fetchLadderData();
  }, [fetchLadderData]);

  // Fetch current round results for additional context
  const fetchCurrentRoundResults = useCallback(async () => {
    try {
      const resultsResponse = await fetch(`/api/store-round-results?round=${currentRound}&year=${selectedYear}`);
      
      if (resultsResponse.ok) {
        const resultsData = await resultsResponse.json();
        
        if (resultsData.found && resultsData.results) {
          setCurrentRoundResults(resultsData.results);
        } else {
          // If no stored results, try to get live results
          const liveResults = await fetchLiveCurrentRoundResults();
          setCurrentRoundResults(liveResults);
        }
      }
    } catch (error) {
      console.warn('Could not fetch current round results:', error);
      setCurrentRoundResults({});
    }
  }, [currentRound]);

  // Fetch live current round results
  const fetchLiveCurrentRoundResults = useCallback(async () => {
    const results = {};
    
    try {
      // Get live results for all users
      const userPromises = Object.keys(USER_NAMES).map(async (userId) => {
        try {
          const response = await fetch(`/api/round-results?round=${currentRound}&userId=${userId}&year=${selectedYear}`);
          if (response.ok) {
            const userData = await response.json();
            return { userId, score: userData.total || 0 };
          }
          return { userId, score: 0 };
        } catch (error) {
          console.warn(`Error getting live results for user ${userId}:`, error);
          return { userId, score: 0 };
        }
      });
      
      const userResults = await Promise.all(userPromises);
      userResults.forEach(({ userId, score }) => {
        results[userId] = score;
      });
      
    } catch (error) {
      console.error('Error fetching live round results:', error);
    }
    
    return results;
  }, [currentRound]);

  // Get team's current round score
  const getTeamCurrentRoundScore = useCallback((userId) => {
    return currentRoundResults[userId] || 0;
  }, [currentRoundResults]);

  // Get team's ladder position
  const getTeamLadderPosition = useCallback((userId) => {
    const position = ladder.findIndex(team => team.userId === userId);
    return position >= 0 ? position + 1 : null;
  }, [ladder]);

  // Helper functions for finals
  const isFinalRound = (round) => {
    return round >= 22 && round <= 24;
  };

  const getFinalRoundName = (round) => {
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
  };

  // Get finals fixtures based on ladder positions
  const getFinalsFixtures = useCallback((finalRound) => {
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
  }, [ladder]);

  // Refresh data manually
  const refreshLadder = useCallback(async () => {
    await fetchLadderData();
  }, [fetchLadderData]);

  return {
    // State
    ladder,
    currentRoundResults,
    loading,
    error,
    currentRound,
    lastUpdated,
    dataSource,
    
    // Actions
    changeRound,
    refreshLadder,
    
    // Getters
    getTeamCurrentRoundScore,
    getTeamLadderPosition,
    getFinalsFixtures,
    
    // Helper functions
    isFinalRound,
    getFinalRoundName
  };
}
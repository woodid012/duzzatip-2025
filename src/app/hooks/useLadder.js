'use client'

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { USER_NAMES } from '@/app/lib/constants';

export default function useLadder() {
  const { currentRound, changeRound } = useAppContext();
  
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
      
      // First, try to get cached ladder from database
      const ladderResponse = await fetch(`/api/ladder?round=${currentRound}`);
      
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
        setDataSource(ladderData.fromCache ? 'cached' : 'calculated');
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
      const resultsResponse = await fetch(`/api/store-round-results?round=${currentRound}`);
      
      if (resultsResponse.ok) {
        const resultsData = await resultsResponse.json();
        
        if (resultsData.found && resultsData.results) {
          setCurrentRoundResults(resultsData.results);
        } else {
          setCurrentRoundResults({});
        }
      }
    } catch (error) {
      console.warn('Could not fetch current round results:', error);
      setCurrentRoundResults({});
    }
  }, [currentRound]);

  // Force recalculate ladder from stored results
  const recalculateLadder = useCallback(async () => {
    if (currentRound === undefined || currentRound === null) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log(`Force recalculating ladder for round ${currentRound}`);
      
      const response = await fetch('/api/ladder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round: currentRound,
          standings: [],
          forceRecalculate: true
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to recalculate ladder');
      }
      
      const data = await response.json();
      
      if (data.standings) {
        setLadder(data.standings);
        setLastUpdated(new Date());
        setDataSource('recalculated');
        console.log(`Successfully recalculated ladder for round ${currentRound}`);
      }
      
    } catch (err) {
      console.error('Error recalculating ladder:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentRound]);

  // Calculate and store current round results
  const calculateAndStoreCurrentRound = useCallback(async (forceRecalculate = false) => {
    if (currentRound === undefined || currentRound === null) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log(`Calculating and storing results for round ${currentRound}`);
      
      const response = await fetch('/api/store-round-results', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round: currentRound,
          forceRecalculate: forceRecalculate
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to calculate and store round results');
      }
      
      const data = await response.json();
      
      if (data.success) {
        console.log(data.message);
        setCurrentRoundResults(data.results || {});
        
        // Trigger a re-fetch of ladder data by updating a trigger state
        // This is safer than calling fetchLadderData directly
        window.location.reload(); // Simple but effective solution
      }
      
      return data;
      
    } catch (err) {
      console.error('Error calculating and storing round results:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [currentRound]);

  // Clear cached data for current round
  const clearCachedData = useCallback(async () => {
    if (currentRound === undefined || currentRound === null) return;
    
    try {
      console.log(`Clearing cached data for round ${currentRound}`);
      
      // Clear cached ladder
      await fetch(`/api/ladder?round=${currentRound}`, {
        method: 'DELETE'
      });
      
      // Clear stored round results
      await fetch(`/api/store-round-results?round=${currentRound}`, {
        method: 'DELETE'
      });
      
      // Refresh data
      setTimeout(async () => {
        await fetchLadderData();
      }, 500);
      
    } catch (err) {
      console.error('Error clearing cached data:', err);
      setError(err.message);
    }
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
    recalculateLadder,
    calculateAndStoreCurrentRound,
    clearCachedData,
    
    // Getters
    getTeamCurrentRoundScore,
    getTeamLadderPosition,
    getFinalsFixtures,
    
    // Helper functions
    isFinalRound,
    getFinalRoundName
  };
}
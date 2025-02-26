'use client'

import { useState, useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { calculateLadder, isFinalRound, getFinalRoundName } from '@/app/lib/ladder_utils';
import { USER_NAMES } from '@/app/lib/constants';

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

  // Fetch scores for a specific round
  const fetchRoundScores = async (round) => {
    try {
      // Special case for round 0 (opening-round)
      if (round === 0) {
        // In a real app, this would be an API call to get the opening-round scores
        // For now, we'll simulate some data
        return Object.fromEntries(
          Object.keys(USER_NAMES).map(userId => [
            userId,
            Math.floor(Math.random() * 100) + 50 // Random score between 50-149
          ])
        );
      }
      
      const fixtures = getFixturesForRound(round);
      if (!fixtures || fixtures.length === 0) return null;
      
      const scores = {};
      
      // For each fixture, get the user scores
      for (const fixture of fixtures) {
        const homeId = fixture.home.toString();
        const awayId = fixture.away.toString();
        
        // Skip fixtures with placeholder teams (finals)
        if (typeof fixture.home !== 'number' || typeof fixture.away !== 'number') {
          continue;
        }

        // Get scores from the round-results API
        const homeRes = await fetch(`/api/round-results?round=${round}&userId=${homeId}`);
        const awayRes = await fetch(`/api/round-results?round=${round}&userId=${awayId}`);
        
        if (homeRes.ok) {
          const homeData = await homeRes.json();
          scores[homeId] = homeData.total || 0;
        }
        
        if (awayRes.ok) {
          const awayData = await awayRes.json();
          scores[awayId] = awayData.total || 0;
        }
      }
      
      return scores;
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
    
    // Helper functions
    isFinalRound,
    getFinalRoundName
  };
}
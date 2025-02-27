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
      // For all rounds, use the round-results API
      const scores = {};
      
      // Fetch scores for each user (1-8)
      for (const userId of Object.keys(USER_NAMES)) {
        try {
          const res = await fetch(`/api/round-results?round=${round}&userId=${userId}`);
          if (res.ok) {
            const data = await res.json();
            scores[userId] = data.total || 0;
          }
        } catch (userError) {
          console.warn(`Could not fetch scores for user ${userId}, round ${round}:`, userError);
          // Continue with other users even if one fails
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
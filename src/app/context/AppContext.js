'use client'

import { createContext, useState, useContext, useEffect, useRef } from 'react';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { processFixtures, calculateRoundInfo, getRoundInfo } from '@/app/lib/timeCalculations';

// In AppContext.js, add a simple caching mechanism
const cache = new Map(); // Add at the top of the file

const fetchWithCache = async (url, expiry = 5 * 60 * 1000) => {
  const cachedResponse = cache.get(url);
  if (cachedResponse && Date.now() - cachedResponse.timestamp < expiry) {
    return cachedResponse.data;
  }
  
  const response = await fetch(url);
  const data = await response.json();
  cache.set(url, { data, timestamp: Date.now() });
  return data;
};

// Create context
const AppContext = createContext();

// Context provider component
export function AppProvider({ children }) {
  // Global state variables
  const [fixtures, setFixtures] = useState([]);
  const [currentRound, setCurrentRound] = useState(0); // Default to Round 0
  const [roundInfo, setRoundInfo] = useState({
    currentRound: 0,
    currentRoundDisplay: 'Opening Round',
    lockoutTime: null,
    isLocked: false,
    roundEndTime: null,
    isError: false
  });
  const [allUsers, setAllUsers] = useState({});
  const [squads, setSquads] = useState({});
  const [teamSelections, setTeamSelections] = useState({});
  const [loading, setLoading] = useState({
    fixtures: true,
    users: true,
    squads: false,
    teamSelections: false
  });
  const [error, setError] = useState(null);
  const [userChangedRound, setUserChangedRound] = useState(false);

  // This effect loads global data like fixtures and round info
  useEffect(() => {
    const fetchFixtures = async () => {
      try {
        setLoading(prev => ({ ...prev, fixtures: true }));
        
        // Use internal API to avoid CORS issues with external API
        const response = await fetch(`/api/tipping-data`);
        if (!response.ok) {
          throw new Error(`Failed to load fixtures: ${response.status}`);
        }
        
        const data = await response.json();
        const fixturesData = Array.isArray(data) ? data : data.fixtures;
        console.log('AppContext: Raw fixtures data from API:', data);

        // Process fixtures
        const processedFixtures = processFixtures(fixturesData);
        console.log('AppContext: Processed fixtures data:', processedFixtures);
        setFixtures(processedFixtures);
        
        // CRITICAL CHANGE: Calculate round info immediately as first priority
        console.log('Calculating current round as first priority...');
        
        // Use normal round calculation logic
        const currentRoundInfo = calculateRoundInfo(processedFixtures);
        setCurrentRound(currentRoundInfo.currentRound);
        console.log('AppContext: Calculated currentRound:', currentRoundInfo.currentRound);
        
        // Get detailed round info for the current round
        const detailedRoundInfo = getRoundInfo(processedFixtures, currentRoundInfo.currentRound);
        
        // Add next round info
        const nextRoundInfo = getRoundInfo(processedFixtures, currentRoundInfo.currentRound + 1);
        
        setRoundInfo({
          ...detailedRoundInfo,
          nextRoundInfo // Include next round info
        });
        console.log('AppContext: Final roundInfo state:', { ...detailedRoundInfo, nextRoundInfo });
        
        setLoading(prev => ({ ...prev, fixtures: false }));
      } catch (err) {
        console.error('Error loading fixtures:', err);
        setError(err.message);
        setLoading(prev => ({ ...prev, fixtures: false }));
        
        // Set default values in case of error
        setCurrentRound(0);
        setRoundInfo({
          currentRound: 0,
          currentRoundDisplay: 'Opening Round',
          lockoutTime: null,
          isLocked: false,
          roundEndTime: null,
          isError: true
        });
      }
    };

    fetchFixtures();
  }, []);

  // Check for early round advancement periodically
  useEffect(() => {
    // Only run this if we have fixtures loaded
    if (fixtures.length === 0) return;

    // Check if we should advance immediately
    if (roundInfo.shouldAdvanceToNextRound) {
      advanceToAppropriateRound();
    }
    
    // Set up an interval to check for round advancement
    const checkInterval = setInterval(() => {
      // Get fresh round info
      const currentRoundInfo = getSpecificRoundInfo(currentRound);
      
      // Check if we should advance
      if (currentRoundInfo.shouldAdvanceToNextRound) {
        advanceToAppropriateRound();
      }
    }, 60 * 60 * 1000); // Check every hour
    
    // Clean up interval on unmount
    return () => clearInterval(checkInterval);
  }, [fixtures, currentRound, roundInfo]); // Re-run when fixtures, currentRound, or roundInfo changes

  // Load squad data
  const fetchSquads = async () => {
    try {
      setLoading(prev => ({ ...prev, squads: true }));
      
      const response = await fetch('/api/squads');
      
      if (!response.ok) {
        throw new Error('Failed to fetch squads');
      }
      
      const data = await response.json();
      setSquads(data);
      
      setLoading(prev => ({ ...prev, squads: false }));
      return data;
    } catch (err) {
      console.error('Error fetching squads:', err);
      setError(err.message);
      setLoading(prev => ({ ...prev, squads: false }));
      return null;
    }
  };

  // Load team selections for a specific round
  const fetchTeamSelections = async (round) => {
    try {
      setLoading(prev => ({ ...prev, teamSelections: true }));
      
      const targetRound = round;
      
      const response = await fetch(`/api/team-selection?round=${targetRound}`);
      if (!response.ok) {
        throw new Error('Failed to fetch team selections');
      }
      
      const data = await response.json();
      setTeamSelections(data);
      
      setLoading(prev => ({ ...prev, teamSelections: false }));
      return data;
    } catch (err) {
      console.error('Error fetching team selections:', err);
      setError(err.message);
      setLoading(prev => ({ ...prev, teamSelections: false }));
      return null;
    }
  };

  // Get info for a specific round
  const getSpecificRoundInfo = (roundNumber) => {
    // If fixtures aren't loaded yet, return default info
    if (!fixtures || fixtures.length === 0) {
      return {
        currentRound: roundNumber,
        currentRoundDisplay: roundNumber === 0 ? 'Opening Round' : `Round ${roundNumber}`,
        lockoutTime: null,
        isLocked: false,
        roundEndTime: null,
        isError: true
      };
    }
    
    // Get round info for requested round
    const info = getRoundInfo(fixtures, roundNumber);
    
    // For round 0, add round 1 info
    if (roundNumber === 0) {
      const round1Info = getRoundInfo(fixtures, 1);
      return {
        ...info,
        nextRoundLockout: round1Info.lockoutTime,
        nextRoundLockoutDate: round1Info.lockoutDate
      };
    }
    
    return info;
  };

  // Update current round and fetch data for that round
  const changeRound = (roundNumber) => {
    // If user manually changes the round, set the flag
    if (roundNumber !== currentRound) {
      setUserChangedRound(true);
    }
    
    // Update round information
    const newRoundInfo = getSpecificRoundInfo(roundNumber);
    setRoundInfo(newRoundInfo);
    setCurrentRound(roundNumber);
  };

  // Automatically advance to the appropriate round
  const advanceToAppropriateRound = () => {
    // Skip automatic advancement if user has manually changed the round
    if (userChangedRound) {
      return;
    }
    
    const now = new Date();
    
    // We've removed special handling for Round 0 -> Round 1 transition
    
    // If current round info says we should advance to next round early
    if (roundInfo.shouldAdvanceToNextRound) {
      console.log(`Advancing to Round ${currentRound + 1} early (2 days before first fixture)`);
      changeRound(currentRound + 1);
      return;
    }
    
    // If current round is locked and there's a next round available
    if (roundInfo.isLocked && roundInfo.nextRoundInfo) {
      changeRound(currentRound + 1);
      return;
    }
    
    // Otherwise calculate the appropriate round
    if (fixtures && fixtures.length > 0) {
      const calculatedInfo = calculateRoundInfo(fixtures);
      
      // Only change if the calculated round is different
      if (calculatedInfo.currentRound !== currentRound) {
        changeRound(calculatedInfo.currentRound);
      }
    }
  };

  // Create context value
  const contextValue = {
    // State
    currentRound,
    roundInfo,
    fixtures,
    squads,
    teamSelections,
    loading,
    error,
    
    // Actions
    changeRound,
    advanceToAppropriateRound,
    fetchSquads,
    fetchTeamSelections,
    getSpecificRoundInfo
  };

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

// Custom hook for using the context
export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
'use client'

import { createContext, useState, useContext, useEffect } from 'react';
import { CURRENT_YEAR, OPENING_ROUND_END_TIME } from '@/app/lib/constants';
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
        
        // Process fixtures
        const processedFixtures = processFixtures(fixturesData);
        setFixtures(processedFixtures);
        
        // Current date
        const now = new Date();
        
        // Check if we're still in Opening Round period
        if (now < OPENING_ROUND_END_TIME) {
          const round0Info = getRoundInfo(processedFixtures, 0);
          setCurrentRound(0);
          setRoundInfo({
            ...round0Info,
            currentRound: 0,
            currentRoundDisplay: 'Opening Round',
            lockoutTime: round0Info.lockoutTime,
            isLocked: round0Info.isLocked,
            roundEndTime: round0Info.roundEndTime
          });
        } 
        // Check if we're after Opening Round but before Round 1 lockout
        else {
          const round1Info = getRoundInfo(processedFixtures, 1);
          const round1LockoutDate = round1Info.lockoutDate ? new Date(round1Info.lockoutDate) : null;
          
          // If we're before Round 1 lockout
          if (round1LockoutDate && now < round1LockoutDate) {
            // For team selection and tipping, we want to show Round 1
            setCurrentRound(1);
            setRoundInfo({
              ...round1Info,
              showResultsForRound0: true, // Flag for the results page to still show round 0
              isRound0Locked: true,       // Flag to indicate round 0 is locked
              prevRoundInfo: getRoundInfo(processedFixtures, 0) // Keep round 0 info for reference
            });
          } else {
            // After round 1 lockout, use normal round calculation logic
            const currentRoundInfo = calculateRoundInfo(processedFixtures);
            setCurrentRound(currentRoundInfo.currentRound);
            
            // Get detailed round info for the current round
            const detailedRoundInfo = getRoundInfo(processedFixtures, currentRoundInfo.currentRound);
            
            // Add next round info
            const nextRoundInfo = getRoundInfo(processedFixtures, currentRoundInfo.currentRound + 1);
            
            setRoundInfo({
              ...detailedRoundInfo,
              nextRoundInfo // Include next round info
            });
          }
        }
        
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
      
      // If round 0 is locked but round 1 isn't, always show round 1 for team selection
      let targetRound = round;
      
      // If round 0 is specified but locked, use round 1 instead
      if (round === 0 && roundInfo.isLocked) {
        targetRound = 1;
      }
      
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
    // Update round information
    const newRoundInfo = getSpecificRoundInfo(roundNumber);
    setRoundInfo(newRoundInfo);
    setCurrentRound(roundNumber);
  };

  // Automatically advance to the appropriate round
  const advanceToAppropriateRound = () => {
    const now = new Date();
    
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
    
    // If in special case where Round 0 is locked but Round 1 isn't
    if (currentRound === 0 && roundInfo.isLocked) {
      changeRound(1);
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
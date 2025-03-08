'use client'

import { createContext, useState, useContext, useEffect } from 'react';
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
        
        // Get detailed round info for round 0 and round 1
        const round0Info = getRoundInfo(processedFixtures, 0);
        const round1Info = getRoundInfo(processedFixtures, 1);
        
        // Check if we're past round 0 lockout but before round 1 lockout
        const now = new Date();
        const round0LockoutDate = round0Info.lockoutDate ? new Date(round0Info.lockoutDate) : null;
        const round1LockoutDate = round1Info.lockoutDate ? new Date(round1Info.lockoutDate) : null;
        
        const isRound0Locked = round0LockoutDate && now >= round0LockoutDate;
        const isBeforeRound1Lockout = round1LockoutDate && now < round1LockoutDate;
        
        // Set current round based on lockout dates
        if (!isRound0Locked) {
          // Before round 0 lockout, show round 0
          setCurrentRound(0);
          setRoundInfo({
            ...round0Info,
            nextRoundLockout: round1Info.lockoutTime,
            nextRoundLockoutDate: round1Info.lockoutDate
          });
        } else if (isBeforeRound1Lockout) {
          // After round 0 lockout but before round 1 lockout
          // For team selection and tipping, show round 1
          // For results, we'll handle this in the results component to show round 0
          setCurrentRound(1);
          setRoundInfo({
            ...round1Info,
            showResultsForRound0: true, // Flag for the results page
            prevRoundInfo: round0Info // Keep round 0 info for reference
          });
        } else {
          // After round 1 lockout, show the current round from calculation
          const currentRoundInfo = calculateRoundInfo(processedFixtures);
          setCurrentRound(currentRoundInfo.currentRound);
          
          const detailedRoundInfo = getRoundInfo(processedFixtures, currentRoundInfo.currentRound);
          setRoundInfo(detailedRoundInfo);
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
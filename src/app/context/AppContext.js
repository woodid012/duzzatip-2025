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
  const [currentRound, setCurrentRound] = useState(0);
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
        
        // Calculate current round info
        const currentRoundInfo = calculateRoundInfo(processedFixtures);
        setCurrentRound(currentRoundInfo.currentRound);
        
        // Get detailed round info for the current round
        const roundInfo = getRoundInfo(processedFixtures, currentRoundInfo.currentRound);
        setRoundInfo(roundInfo);
        
        setLoading(prev => ({ ...prev, fixtures: false }));
      } catch (err) {
        console.error('Error loading fixtures:', err);
        setError(err.message);
        setLoading(prev => ({ ...prev, fixtures: false }));
        
        // Set default values in case of error
        setCurrentRound(1);
        setRoundInfo({
          currentRound: 1,
          currentRoundDisplay: 'Round 1',
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
      
      const response = await fetch(`/api/team-selection?round=${round}`);
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
    
    return getRoundInfo(fixtures, roundNumber);
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
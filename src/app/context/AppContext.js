'use client'

import { createContext, useState, useContext, useEffect, useRef } from 'react';
import { CURRENT_YEAR, MAIN_SEASON_FINAL_ROUND } from '@/app/lib/constants';

// The season pages' round logic lives in a 0-24 world; AFL finals rounds
// (25+, synced for the Duzza Finals side comp) must not advance it. The full
// fixture list (finals included) stays exposed via `fixtures` for pages that
// need it.
const toSeasonFixtures = (all) =>
  (all || []).filter((f) => Number(f.RoundNumber) <= MAIN_SEASON_FINAL_ROUND);
import { processFixtures, calculateRoundInfo, getRoundInfo } from '@/app/lib/timeCalculations';
import { readSnapshot, writeSnapshot } from '@/app/lib/clientSnapshot';

// Every page waits on fixtures before it can fetch anything of its own, so a
// cold start costs two serial round-trips before the first number appears.
// Seeding from the last payload this tab saw removes the first one: round info
// is derived from fixture dates on the client, so a slightly older list still
// resolves the right round, and the fetch below replaces it either way.
const FIXTURES_SNAPSHOT_MAX_AGE = 10 * 60 * 1000;
const fixturesSnapshotKey = (year) => `tipping-data-fixtures:${year}`;

// In AppContext.js, add a simple caching mechanism
const cache = new Map(); // Add at the top of the file

const fetchWithCache = async (url, expiry = 5 * 60 * 1000) => {
  const cachedResponse = cache.get(url);
  if (cachedResponse && Date.now() - cachedResponse.timestamp < expiry) {
    return cachedResponse.data;
  }

  // Delete expired entry before re-fetching
  if (cachedResponse) {
    cache.delete(url);
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
  const [currentRound, setCurrentRound] = useState(null); // null until fixtures load
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
  const [injuries, setInjuries] = useState({});
  const [loading, setLoading] = useState({
    fixtures: true,
    users: true,
    squads: false,
    teamSelections: false
  });
  const [error, setError] = useState(null);
  const [userChangedRound, setUserChangedRound] = useState(false);

  // Year selection state - shared across the app
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const isPastYear = selectedYear !== CURRENT_YEAR;

  // Fetch injuries once on mount (not year-dependent)
  useEffect(() => {
    fetch('/api/injuries')
      .then(r => r.ok ? r.json() : { players: {} })
      .then(data => setInjuries(data.players || {}))
      .catch(() => {});
  }, []);

  // Initialize selectedYear from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedYear = localStorage.getItem('selectedYear');
      if (savedYear) {
        const parsedYear = parseInt(savedYear);
        if (parsedYear >= 2025 && parsedYear <= CURRENT_YEAR) {
          setSelectedYear(parsedYear);
        }
      }
    }
  }, []);

  // This effect loads global data like fixtures and round info
  useEffect(() => {
    // Turns a fixtures payload into the context's fixtures + round state.
    // Shared by the snapshot seed and the network response so both land the
    // same way — the snapshot stores the RAW payload, because processFixtures
    // produces Dates that wouldn't survive a JSON round-trip.
    const applyFixtures = (fixturesData) => {
      const processedFixtures = processFixtures(fixturesData);
      setFixtures(processedFixtures);

      const seasonFixtures = toSeasonFixtures(processedFixtures);

      // Round info first: it's what every page is actually waiting for.
      // A past year is over, so it sits on its last round; the current year is
      // worked out from the fixture dates.
      let currentRoundInfo;
      if (selectedYear !== CURRENT_YEAR) {
        const maxRound = seasonFixtures.length > 0
          ? Math.max(...seasonFixtures.map(f => f.RoundNumber))
          : 1;
        currentRoundInfo = { currentRound: maxRound, isError: false };
      } else {
        currentRoundInfo = calculateRoundInfo(seasonFixtures);
      }
      setCurrentRound(currentRoundInfo.currentRound);

      const detailedRoundInfo = getRoundInfo(seasonFixtures, currentRoundInfo.currentRound);
      const nextRoundInfo = getRoundInfo(seasonFixtures, currentRoundInfo.currentRound + 1);

      setRoundInfo({
        ...detailedRoundInfo,
        nextRoundInfo // Include next round info
      });

      setLoading(prev => ({ ...prev, fixtures: false }));
    };

    const fetchFixtures = async () => {
      // Paint from the last fixture list this tab saw, if it has one, rather
      // than holding every page behind the network.
      const seeded = readSnapshot(fixturesSnapshotKey(selectedYear), {
        maxAgeMs: FIXTURES_SNAPSHOT_MAX_AGE,
      });
      if (seeded) {
        applyFixtures(seeded);
      } else {
        setLoading(prev => ({ ...prev, fixtures: true }));
      }

      try {
        // Use internal API to avoid CORS issues with external API
        const response = await fetch(`/api/tipping-data?year=${selectedYear}`);
        if (!response.ok) {
          throw new Error(`Failed to load fixtures: ${response.status}`);
        }

        const data = await response.json();
        const fixturesData = Array.isArray(data) ? data : data.fixtures;

        applyFixtures(fixturesData);
        writeSnapshot(fixturesSnapshotKey(selectedYear), fixturesData);
      } catch (err) {
        console.error('Error loading fixtures:', err);
        setError(err.message);
        setLoading(prev => ({ ...prev, fixtures: false }));

        // Keep whatever the snapshot already put on screen — it's a real
        // fixture list, and blanking it back to the Opening Round default
        // would be strictly worse than showing it while the fetch retries.
        if (seeded) return;

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

    // Reset user-changed-round flag when switching years
    setUserChangedRound(false);
    fetchFixtures();
  }, [selectedYear]);

  // Check for early round advancement periodically
  const hasAdvancedRef = useRef(false);
  useEffect(() => {
    // Only run this if we have fixtures loaded
    if (fixtures.length === 0) return;

    // Check if we should advance immediately (only once per round)
    if (roundInfo.shouldAdvanceToNextRound && !hasAdvancedRef.current) {
      hasAdvancedRef.current = true;
      advanceToAppropriateRound();
    }

    // Set up an interval to check for round advancement
    const checkInterval = setInterval(() => {
      hasAdvancedRef.current = false; // Allow advancement check again
      // Get fresh round info
      const currentRoundInfo = getSpecificRoundInfo(currentRound);

      // Check if we should advance
      if (currentRoundInfo.shouldAdvanceToNextRound) {
        hasAdvancedRef.current = true;
        advanceToAppropriateRound();
      }
    }, 60 * 60 * 1000); // Check every hour

    // Clean up interval on unmount
    return () => clearInterval(checkInterval);
  }, [fixtures]); // Only re-run when fixtures change, not currentRound

  // Load squad data
  const fetchSquads = async () => {
    try {
      setLoading(prev => ({ ...prev, squads: true }));
      
      const response = await fetch(`/api/squads?year=${selectedYear}`);
      
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
      
      const response = await fetch(`/api/team-selection?round=${targetRound}&year=${selectedYear}`);
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
    const info = getRoundInfo(toSeasonFixtures(fixtures), roundNumber);
    
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
    
    // The season ends at round 24 — never auto-advance into the AFL finals
    // rounds (those belong to the Duzza Finals side comp).
    const canAdvance = currentRound < MAIN_SEASON_FINAL_ROUND;

    // If current round info says we should advance to next round early
    if (roundInfo.shouldAdvanceToNextRound && canAdvance) {
      console.log(`Advancing to Round ${currentRound + 1} early (2 days before first fixture)`);
      changeRound(currentRound + 1);
      return;
    }

    // If current round is locked and there's a next round available
    if (roundInfo.isLocked && roundInfo.nextRoundInfo && canAdvance) {
      changeRound(currentRound + 1);
      return;
    }
    
    // Otherwise calculate the appropriate round
    if (fixtures && fixtures.length > 0) {
      const calculatedInfo = calculateRoundInfo(toSeasonFixtures(fixtures));
      
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
    selectedYear,
    isPastYear,
    injuries,

    // Actions
    changeRound,
    advanceToAppropriateRound,
    fetchSquads,
    fetchTeamSelections,
    getSpecificRoundInfo,
    setSelectedYear,
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
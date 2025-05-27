'use client'

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/app/context/AppContext';
import useResults from '@/app/hooks/useResults';
import { USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { useUserContext } from '../layout';

// Import the modular components
import { TeamScoreCard, WelcomeScreen, RoundSummary } from './components';

export default function ResultsPage() {
  // Get data from our app context
  const { currentRound, roundInfo, loading: contextLoading } = useAppContext();
  
  // Get the selected user from context
  const { selectedUserId, setSelectedUserId } = useUserContext();
  
  // Keep the displayed round as null until we're ready
  const [displayedRound, setDisplayedRound] = useState(null);
  
  // Progress tracking states
  const [contextReady, setContextReady] = useState(false);
  const [roundInitialized, setRoundInitialized] = useState(false);
  const [teamSelectionsLoaded, setTeamSelectionsLoaded] = useState(false);
  const [displayReady, setDisplayReady] = useState(false);
  
  // Track loading state of each step
  const [loadingStates, setLoadingStates] = useState({
    context: true,
    round: true,
    teamSelections: false,
    playerStats: false,
    display: false
  });
  
  // Refs to prevent duplicate initializations
  const didInitializeRound = useRef(false);
  const didFetchTeamSelections = useRef(false);
  
  // Get results functionality from our hook
  const {
    teams,
    loading: resultsLoading,
    error,
    roundEndPassed,
    calculateAllTeamScores,
    getTeamScores,
    currentRound: hookRound,
    changeRound: hookChangeRound,
    roundInitialized: hookDataReady
  } = useResults();

  // State for fixtures
  const [fixtures, setFixtures] = useState([]);
  const [orderedFixtures, setOrderedFixtures] = useState([]);
  const [pageReady, setPageReady] = useState(false);

  // Loading status message
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  
  // Initialize empty team scores to prevent flashing
  const [teamScores, setTeamScores] = useState(() => {
    const initialScores = {};
    Object.keys(USER_NAMES).forEach(userId => {
      initialScores[userId] = {
        userId,
        totalScore: "", // Initialize as empty string
        teamOnly: "",
        deadCert: "",
        finalScore: "",
        positionScores: [],
        benchScores: [],
        substitutionsEnabled: { bench: false, reserve: false }
      };
    });
    return initialScores;
  });
  
  // 1. STEP ONE: Wait for context to be ready
  useEffect(() => {
    if (!contextLoading.fixtures && 
        currentRound !== undefined && 
        currentRound !== null && 
        roundInfo && !roundInfo.isError) {
      console.log(`Context is ready, current round: ${currentRound}`);
      setContextReady(true);
      setLoadingStates(prev => ({ ...prev, context: false }));
      setLoadingStatus('Context loaded, getting current round...');
    }
  }, [contextLoading.fixtures, currentRound, roundInfo]);
  
  // 2. STEP TWO: Set displayed round from context
  useEffect(() => {
    if (contextReady && !didInitializeRound.current) {
      console.log(`Setting displayed round to ${currentRound} from global context`);
      setDisplayedRound(currentRound);
      didInitializeRound.current = true;
      setRoundInitialized(true);
      setLoadingStates(prev => ({ ...prev, round: false, teamSelections: true }));
      setLoadingStatus('Current round set, loading team selections...');
    }
  }, [contextReady, currentRound]);
  
  // 3. STEP THREE: Load team selections for the current round
  useEffect(() => {
    const loadTeamSelections = async () => {
      if (roundInitialized && 
          displayedRound !== null && 
          !didFetchTeamSelections.current &&
          loadingStates.teamSelections) {
        try {
          console.log(`Loading team selections for round ${displayedRound}`);
          setLoadingStatus(`Loading team selections for round ${displayedRound}...`);
          
          const response = await fetch(`/api/team-selection?round=${displayedRound}`);
          if (response.ok) {
            const data = await response.json();
            console.log('Team selections loaded successfully');
            didFetchTeamSelections.current = true;
            setTeamSelectionsLoaded(true);
            setLoadingStates(prev => ({ ...prev, teamSelections: false, playerStats: true }));
            setLoadingStatus('Team selections loaded, now loading player stats...');
          } else {
            console.error('Failed to load team selections');
            setLoadingStatus('Error loading team selections, continuing anyway...');
            // Still mark as loaded to continue
            didFetchTeamSelections.current = true;
            setTeamSelectionsLoaded(true);
            setLoadingStates(prev => ({ ...prev, teamSelections: false, playerStats: true }));
          }
        } catch (error) {
          console.error('Error loading team selections:', error);
          setLoadingStatus('Error loading team selections, continuing anyway...');
          // Still mark as loaded to continue
          didFetchTeamSelections.current = true;
          setTeamSelectionsLoaded(true);
          setLoadingStates(prev => ({ ...prev, teamSelections: false, playerStats: true }));
        }
      }
    };
    
    loadTeamSelections();
  }, [roundInitialized, displayedRound, loadingStates.teamSelections]);
  
  // 4. STEP FOUR: Load player stats after team selections are loaded
  useEffect(() => {
    if (teamSelectionsLoaded && 
        displayedRound !== null && 
        loadingStates.playerStats) {
      console.log(`Initializing hook with round ${displayedRound} to fetch player stats`);
      setLoadingStatus(`Loading player stats for round ${displayedRound}...`);
      
      if (hookChangeRound) {
        hookChangeRound(displayedRound);
        setLoadingStates(prev => ({ ...prev, playerStats: false }));
      }
    }
  }, [teamSelectionsLoaded, displayedRound, hookChangeRound, loadingStates.playerStats]);
  
  // 5. STEP FIVE: When player stats are loaded, calculate scores and prepare display
  useEffect(() => {
    if (displayedRound !== null && 
        !resultsLoading && 
        hookDataReady && 
        teams && 
        Object.keys(teams).length > 0 && 
        teamSelectionsLoaded) {
      console.log('Player stats loaded, calculating scores...');
      setLoadingStatus('Stats loaded, calculating scores...');
      
      // Calculate team scores ONCE and store them
      const calculatedScores = {};
      Object.keys(USER_NAMES).forEach(userId => {
        calculatedScores[userId] = getTeamScores(userId);
      });
      
      // Update team scores state
      setTeamScores(calculatedScores);
      
      // Get fixtures for the displayed round
      const roundFixtures = getFixturesForRound(displayedRound);
      setFixtures(roundFixtures || []);
      
      // Prioritize the selected user's fixture if applicable
      if (selectedUserId && roundFixtures && roundFixtures.length > 0) {
        const userFixture = roundFixtures.find(fixture => 
          fixture.home == selectedUserId || fixture.away == selectedUserId
        );
        
        if (userFixture) {
          setOrderedFixtures([
            userFixture,
            ...roundFixtures.filter(fixture => fixture !== userFixture)
          ]);
        } else {
          setOrderedFixtures(roundFixtures);
        }
      } else {
        setOrderedFixtures(roundFixtures);
      }
      
      setDisplayReady(true);
      setLoadingStates(prev => ({ ...prev, display: true }));
      setLoadingStatus('All data loaded, rendering page...');
      
      // Give a small delay to ensure everything is rendered properly
      setTimeout(() => {
        setPageReady(true);
      }, 100);
    }
  }, [displayedRound, resultsLoading, hookDataReady, teams, teamSelectionsLoaded, selectedUserId, getTeamScores]);

  // Handle round change - keep it local, don't update global context
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    if (newRound !== displayedRound) {
      console.log(`Changing to round ${newRound}`);
      
      // Reset team scores to empty immediately to prevent flashing
      const emptyScores = {};
      Object.keys(USER_NAMES).forEach(userId => {
        emptyScores[userId] = {
          userId,
          totalScore: "",
          teamOnly: "",
          deadCert: "",
          finalScore: "",
          positionScores: [],
          benchScores: [],
          substitutionsEnabled: { bench: false, reserve: false }
        };
      });
      setTeamScores(emptyScores);
      
      // Reset all states to load data for the new round
      setDisplayedRound(newRound);
      setPageReady(false);
      setDisplayReady(false);
      setTeamSelectionsLoaded(false);
      didFetchTeamSelections.current = false;
      
      // Reset loading states
      setLoadingStates({
        context: false,
        round: false,
        teamSelections: true,
        playerStats: false,
        display: false
      });
      
      setLoadingStatus(`Loading data for round ${newRound}...`);
    }
  };

  // Display round name
  const displayRoundName = (round) => {
    if (round === 0) return 'Opening Round';
    if (round >= 22 && round <= 24) {
      // Finals rounds
      if (round === 22) return 'Qualifying Finals';
      if (round === 23) return 'Preliminary Final';
      if (round === 24) return 'Grand Final';
    }
    return `Round ${round}`;
  };

  // Check if the round is complete
  const isRoundComplete = () => {
    if (!roundInfo.roundEndTime) return false;
    const now = new Date();
    const roundEnd = new Date(roundInfo.roundEndTime);
    return now > roundEnd;
  };

  // Show detailed loading UI
  if (!pageReady) {
    return (
      <div className="p-8 text-center">
        <div role="status" className="flex flex-col items-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-lg font-medium">Loading...</span>
          <span className="text-sm text-gray-500 mt-2">
            {loadingStatus}
          </span>
          <div className="mt-4 flex justify-center items-center space-x-2">
            <div className={`h-2 w-2 rounded-full ${!loadingStates.context ? 'bg-green-500' : 'bg-gray-300'}`}></div>
            <div className={`h-2 w-2 rounded-full ${!loadingStates.round ? 'bg-green-500' : 'bg-gray-300'}`}></div>
            <div className={`h-2 w-2 rounded-full ${!loadingStates.teamSelections ? 'bg-green-500' : 'bg-gray-300'}`}></div>
            <div className={`h-2 w-2 rounded-full ${!loadingStates.playerStats ? 'bg-green-500' : 'bg-gray-300'}`}></div>
            <div className={`h-2 w-2 rounded-full ${loadingStates.display ? 'bg-green-500' : 'bg-gray-300'}`}></div>
          </div>
        </div>
      </div>
    );
  }
  
  if (error) return (
    <div className="p-4 bg-red-50 border border-red-300 rounded-lg text-red-700">
      <h3 className="font-bold text-lg mb-2">Error Loading Data</h3>
      <p>{error}</p>
      <button 
        onClick={() => window.location.reload()}
        className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
      >
        Refresh Page
      </button>
    </div>
  );

  // Calculate all team scores using the stored scores
  const allTeamScores = Object.keys(USER_NAMES).map(userId => {
    const teamScore = teamScores[userId];
    return {
      userId,
      totalScore: teamScore.finalScore || 0, // Use finalScore which includes dead cert scores
      teamOnly: teamScore.totalScore || 0,
      deadCert: teamScore.deadCertScore || 0
    };
  });
  
  // Filter out any zero or undefined scores for comparison
  const validScores = allTeamScores.filter(s => (s?.totalScore || 0) > 0);
  const highestScore = validScores.length > 0 
    ? Math.max(...validScores.map(s => s?.totalScore || 0)) 
    : 0;
  const lowestScore = validScores.length > 0 
    ? Math.min(...validScores.map(s => s?.totalScore || 0)) 
    : 0;

  const hasSubstitutions = roundEndPassed;

  // Function to sort and arrange team cards
  const getTeamCardsOrder = () => {
    if (orderedFixtures && orderedFixtures.length > 0) {
      // For regular rounds, generate team cards in matchup order
      return orderedFixtures.flatMap((fixture) => {
        const homeUserId = fixture.home?.toString();
        const awayUserId = fixture.away?.toString();
        
        // Skip if not numeric IDs (e.g., 'TBD' placeholders in finals)
        if (!homeUserId || !awayUserId || isNaN(Number(homeUserId)) || isNaN(Number(awayUserId))) {
          return [];
        }
        
        // If this is the selected user's fixture, prioritize their team card first
        if (selectedUserId && (homeUserId === selectedUserId || awayUserId === selectedUserId)) {
          if (homeUserId === selectedUserId) {
            return [homeUserId, awayUserId];
          } else {
            return [awayUserId, homeUserId];
          }
        }
        
        // Otherwise return both cards in normal order
        return [homeUserId, awayUserId];
      });
    } else {
      // When no fixtures, display all team cards in default order, prioritizing selected user
      return [...Object.keys(USER_NAMES)].sort((a, b) => {
        // First prioritize the selected user
        if (a === selectedUserId) return -1;
        if (b === selectedUserId) return 1;
        
        // Then sort by score
        const scoreA = allTeamScores.find(s => s?.userId === a)?.totalScore || 0;
        const scoreB = allTeamScores.find(s => s?.userId === b)?.totalScore || 0;
        return scoreB - scoreA; // Sort descending
      });
    }
  };
  
  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-black">Team Scores</h1>
          <div className="w-full sm:w-auto flex items-center gap-2">
            <label htmlFor="round-select" className="text-sm font-medium text-black">Round:</label>
            <select 
              id="round-select"
              value={displayedRound || ""}
              onChange={handleRoundChange}
              className="p-2 border rounded w-24 text-sm text-black"
            >
              {[...Array(25)].map((_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? 'Opening' : i}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Link href="/pages/ladder" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          View Ladder
        </Link>
      </div>

      {/* Round Summary Section */}
      <RoundSummary 
        displayedRound={displayedRound}
        roundName={displayRoundName(displayedRound)}
        orderedFixtures={orderedFixtures}
        allTeamScores={allTeamScores}
        selectedUserId={selectedUserId}
        hasSubstitutions={hasSubstitutions}
      />
      
      {/* Team Cards Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {getTeamCardsOrder().map(userId => {
          if (!userId || !USER_NAMES[userId]) return null;
          
          const userTeamScores = teamScores[userId];
          return (
            <TeamScoreCard 
              key={userId}
              userId={userId}
              userName={USER_NAMES[userId]}
              teamScores={userTeamScores}
              isHighestScore={userTeamScores.finalScore === highestScore && highestScore > 0}
              isLowestScore={userTeamScores.finalScore === lowestScore && lowestScore > 0}
              isSelectedUser={userId === selectedUserId}
              isRoundComplete={isRoundComplete()}
            />
          );
        })}
      </div>
      
    </div>
  );
}
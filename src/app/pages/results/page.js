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
  
  // Important: Use null for displayedRound until we're ready to set it
  const [displayedRound, setDisplayedRound] = useState(null);
  
  // Add states to track initialization progress
  const [contextReady, setContextReady] = useState(false);
  const [roundInitialized, setRoundInitialized] = useState(false);
  const [teamSelectionsLoaded, setTeamSelectionsLoaded] = useState(false);
  const [statsLoadStarted, setStatsLoadStarted] = useState(false);
  
  // Ref to track if we've initialized the round
  const didInitializeRound = useRef(false);
  
  // Get results functionality from our hook
  const {
    teams,
    loading,
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
  const [shouldShowWelcome, setShouldShowWelcome] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  
  // Step 1: Wait for context to be ready
  useEffect(() => {
    if (!contextLoading.fixtures && 
        currentRound !== undefined && 
        currentRound !== null && 
        roundInfo && !roundInfo.isError) {
      console.log(`Context is ready, current round: ${currentRound}`);
      setContextReady(true);
    }
  }, [contextLoading.fixtures, currentRound, roundInfo]);
  
  // Step 2: Set displayed round from context when ready
  useEffect(() => {
    if (contextReady && !didInitializeRound.current) {
      console.log(`Setting displayed round to ${currentRound} from global context`);
      setDisplayedRound(currentRound);
      didInitializeRound.current = true;
      setRoundInitialized(true);
    }
  }, [contextReady, currentRound]);
  
  // Step 3: First load the team selections
  useEffect(() => {
    if (roundInitialized && displayedRound !== null && !teamSelectionsLoaded) {
      const loadTeamSelections = async () => {
        try {
          console.log(`Loading team selections for round ${displayedRound}`);
          const response = await fetch(`/api/team-selection?round=${displayedRound}`);
          if (response.ok) {
            const data = await response.json();
            console.log('Team selections loaded successfully');
            // Just loading the selections is enough - the hook will use them
            setTeamSelectionsLoaded(true);
          } else {
            console.error('Failed to load team selections');
            // Still mark as loaded so we can continue
            setTeamSelectionsLoaded(true);
          }
        } catch (error) {
          console.error('Error loading team selections:', error);
          // Still mark as loaded so we can continue
          setTeamSelectionsLoaded(true);
        }
      };
      
      loadTeamSelections();
    }
  }, [roundInitialized, displayedRound, teamSelectionsLoaded]);
  
  // Step 4: After team selections are loaded, initialize the hook to fetch stats
  useEffect(() => {
    if (teamSelectionsLoaded && displayedRound !== null && !statsLoadStarted) {
      console.log(`Initializing hook with round ${displayedRound} to fetch player stats`);
      if (hookChangeRound) {
        hookChangeRound(displayedRound);
        setStatsLoadStarted(true);
      }
    }
  }, [teamSelectionsLoaded, displayedRound, hookChangeRound, statsLoadStarted]);
  
  // Step 5: Set page as ready once data is loaded
  useEffect(() => {
    if (displayedRound !== null && !loading && hookDataReady && teams && Object.keys(teams).length > 0 && teamSelectionsLoaded) {
      console.log('All data loaded, setting page as ready');
      setPageReady(true);
    }
  }, [displayedRound, loading, hookDataReady, teams, teamSelectionsLoaded]);

  // Check if the round is complete based on roundEndTime
  const isRoundComplete = () => {
    if (!roundInfo.roundEndTime) return false;
    const now = new Date();
    const roundEnd = new Date(roundInfo.roundEndTime);
    return now > roundEnd;
  };

  // Get fixtures for the displayed round - only when displayedRound changes
  useEffect(() => {
    if (displayedRound === null) {
      return; // Return early without loading fixtures
    }
    
    console.log(`Getting fixtures for round ${displayedRound}`);
    
    // Get fixtures for the displayed round
    const roundFixtures = getFixturesForRound(displayedRound);
    setFixtures(roundFixtures || []);
    
    // Reorganize fixtures to prioritize the selected user's match
    if (selectedUserId && roundFixtures && roundFixtures.length > 0) {
      // First check if the user is participating in this round
      const userFixture = roundFixtures.find(fixture => 
        fixture.home == selectedUserId || fixture.away == selectedUserId
      );
      
      if (userFixture) {
        // Create a new array with the user's fixture first
        const reorderedFixtures = [
          userFixture,
          ...roundFixtures.filter(fixture => fixture !== userFixture)
        ];
        setOrderedFixtures(reorderedFixtures);
      } else {
        setOrderedFixtures(roundFixtures);
      }
    } else {
      // If no user selected, use the original order
      setOrderedFixtures(roundFixtures);
    }
  }, [displayedRound, selectedUserId]);

  // Handle round change - keep it local, don't update global context
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    if (newRound !== displayedRound) {
      console.log(`Changing to local round ${newRound} (global context remains unchanged)`);
      setDisplayedRound(newRound);
      setPageReady(false); // Reset page ready state
      
      // Important: Call changeRound from the useResults hook
      if (hookChangeRound) {
        hookChangeRound(newRound);
      }
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

  // Show enhanced loading state with details about what we're waiting for
  if (!pageReady) {
    return (
      <div className="p-8 text-center">
        <div role="status" className="flex flex-col items-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-lg font-medium">Loading round data...</span>
          <span className="text-sm text-gray-500 mt-2">
            {!contextReady ? 'Waiting for round information...' : 
             !roundInitialized ? 'Initializing round data...' : 
             !teamSelectionsLoaded ? 'Loading team selections...' :
             !statsLoadStarted ? 'Preparing to fetch player stats...' :
             !hookDataReady ? 'Fetching player stats...' :
             'Finalizing team scores...'}
          </span>
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

  // Calculate team scores once, outside the render logic
  const allTeamScores = Object.keys(USER_NAMES).map(userId => {
    const teamScore = getTeamScores(userId);
    return {
      userId,
      totalScore: teamScore.finalScore || 0, // Use finalScore which includes dead cert scores
      teamOnly: teamScore.totalScore || 0,
      deadCert: teamScore.deadCertScore || 0
    };
  });
  
  // Filter out any zero or undefined scores when determining highest/lowest
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
              value={displayedRound}
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
          
          const teamScores = getTeamScores(userId);
          return (
            <TeamScoreCard 
              key={userId}
              userId={userId}
              userName={USER_NAMES[userId]}
              teamScores={teamScores}
              isHighestScore={teamScores.finalScore === highestScore && highestScore > 0}
              isLowestScore={teamScores.finalScore === lowestScore && lowestScore > 0}
              isSelectedUser={userId === selectedUserId}
              isRoundComplete={isRoundComplete()}
            />
          );
        })}
      </div>
      
    </div>
  );
}
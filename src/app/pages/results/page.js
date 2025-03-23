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
  
  // Important: Start with null to ensure proper initialization from context
  const [displayedRound, setDisplayedRound] = useState(null);
  
  // Create a state to track whether the context is fully initialized
  const [isContextInitialized, setIsContextInitialized] = useState(false);
  
  // Flag to track if we've already initialized the round
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
    changeRound: hookChangeRound
  } = useResults();

  // State for fixtures
  const [fixtures, setFixtures] = useState([]);
  const [orderedFixtures, setOrderedFixtures] = useState([]);
  const [shouldShowWelcome, setShouldShowWelcome] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  
  // Track when context is ready (not just loaded)
  useEffect(() => {
    // Context is considered initialized when:
    // - Fixtures are loaded (context loading is done)
    // - Current round has been calculated (is not undefined)
    // - Round info is available
    if (!contextLoading.fixtures && 
        currentRound !== undefined && 
        roundInfo && !roundInfo.isError) {
      setIsContextInitialized(true);
    }
  }, [contextLoading.fixtures, currentRound, roundInfo]);
  
  // Set displayed round from context current round when context is fully initialized
  useEffect(() => {
    if (isContextInitialized && !didInitializeRound.current) {
      console.log(`RESULTS PAGE: Context is ready, initializing with round: ${currentRound}`);
      setDisplayedRound(currentRound);
      
      if (hookChangeRound) {
        hookChangeRound(currentRound);
      }
      
      didInitializeRound.current = true;
    }
  }, [isContextInitialized, currentRound, hookChangeRound]);
  
  // Secondary fallback - use hook's round if context failed
  useEffect(() => {
    if (!didInitializeRound.current && hookRound !== null && hookRound !== undefined) {
      console.log(`RESULTS PAGE: Fallback - setting displayed round to hook's round: ${hookRound}`);
      setDisplayedRound(hookRound);
      didInitializeRound.current = true;
    }
  }, [hookRound]);
  
  // Ensure page ready status
  useEffect(() => {
    if (!loading && teams && Object.keys(teams).length > 0) {
      setPageReady(true);
    } else {
      setPageReady(false);
    }
  }, [loading, teams]);

  // Check if the round is complete based on roundEndTime
  const isRoundComplete = () => {
    // For all rounds, check roundInfo.roundEndTime
    if (!roundInfo.roundEndTime) return false;
    const now = new Date();
    const roundEnd = new Date(roundInfo.roundEndTime);
    return now > roundEnd;
  };

  // Check if we should display the welcome screen - removed as requested
  useEffect(() => {
    // Always set this to false since we don't want the welcome screen anymore
    setShouldShowWelcome(false);
  }, [displayedRound]);

  // Get fixtures for the displayed round - only when displayedRound changes
  useEffect(() => {
    if (displayedRound === null) {
      return; // Return early without loading fixtures
    }
    
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
      
      // Important: Call changeRound from the useResults hook without updating global context
      if (hookChangeRound) {
        // This will update the hook's internal state without affecting global context
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

  // Show loading during initial phase
  if (!isContextInitialized || displayedRound === null || !pageReady) {
    return (
      <div className="p-8 text-center">
        <div role="status" className="flex flex-col items-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-lg font-medium">Waiting for round calculation...</span>
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
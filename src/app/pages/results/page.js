// src/app/pages/results/page.js

'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/app/context/AppContext';
import useSimplifiedResults from '@/app/hooks/useSimplifiedResults';
import { USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { calculateFinalsFixtures, isFinalRound, getFinalsRoundName } from '@/app/lib/finals_utils';
import { useUserContext } from '../layout';

// Import the modular components
import { TeamScoreCard, WelcomeScreen } from './components';
// Import a new component we'll create for the enhanced round summary
import EnhancedRoundSummary from './components/EnhancedRoundSummary';

export default function ResultsPage() {
  // Get data from our app context
  const { currentRound, roundInfo } = useAppContext();
  
  // Get the selected user from context
  const { selectedUserId } = useUserContext();
  
  // Get results functionality from our simplified hook
  const {
    currentRound: displayedRound,
    teamScores,
    loading,
    error,
    roundEndPassed,
    calculateAllTeamScores,
    getTeamScores,
    changeRound,
    roundData,
    loadingStage,
    loadingMessage,
    fixtures: hookFixtures
  } = useSimplifiedResults();

  // State for ordered fixtures (prioritizing selected user)
  const [orderedFixtures, setOrderedFixtures] = useState([]);
  
  // Update ordered fixtures when hook fixtures or selected user changes
  useEffect(() => {
    if (!hookFixtures || hookFixtures.length === 0) return;
    
    // Prioritize the selected user's fixture if applicable
    if (selectedUserId && hookFixtures.length > 0) {
      const userFixture = hookFixtures.find(fixture => 
        fixture.home?.toString() === selectedUserId?.toString() || 
        fixture.away?.toString() === selectedUserId?.toString()
      );
      
      if (userFixture) {
        setOrderedFixtures([
          userFixture,
          ...hookFixtures.filter(fixture => fixture !== userFixture)
        ]);
      } else {
        setOrderedFixtures(hookFixtures);
      }
    } else {
      setOrderedFixtures(hookFixtures);
    }
  }, [hookFixtures, selectedUserId]);

  // Handle round change - simplified
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    if (newRound !== displayedRound) {
      changeRound(newRound);
    }
  };

  // Display round name
  const displayRoundName = (round) => {
    if (round === 0) return 'Opening Round';
    if (isFinalRound(round)) {
      return getFinalsRoundName(round);
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

  // Show progressive loading UI
  if (loading) {
    return (
      <div className="p-8 text-center">
        <div role="status" className="flex flex-col items-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-lg font-medium text-black">{loadingMessage || 'Loading...'}</span>
          
          {/* Progress indicators */}
          <div className="mt-6 flex justify-center items-center space-x-4">
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full transition-colors duration-300 ${
                loadingStage === 'round' || loadingStage === 'fixtures' || loadingStage === 'results' || loadingStage === 'complete' 
                  ? 'bg-blue-500' : 'bg-gray-300'
              }`}></div>
              <span className="text-xs mt-1 text-gray-600">Round</span>
            </div>
            <div className={`h-0.5 w-8 transition-colors duration-300 ${
              loadingStage === 'fixtures' || loadingStage === 'results' || loadingStage === 'complete'
                ? 'bg-blue-500' : 'bg-gray-300'
            }`}></div>
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full transition-colors duration-300 ${
                loadingStage === 'fixtures' || loadingStage === 'results' || loadingStage === 'complete'
                  ? 'bg-blue-500' : 'bg-gray-300'
              }`}></div>
              <span className="text-xs mt-1 text-gray-600">Fixtures</span>
            </div>
            <div className={`h-0.5 w-8 transition-colors duration-300 ${
              loadingStage === 'results' || loadingStage === 'complete'
                ? 'bg-blue-500' : 'bg-gray-300'
            }`}></div>
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full transition-colors duration-300 ${
                loadingStage === 'results' || loadingStage === 'complete'
                  ? 'bg-blue-500' : 'bg-gray-300'
              }`}></div>
              <span className="text-xs mt-1 text-gray-600">Results</span>
            </div>
          </div>
          
          {/* Stage-specific details */}
          <div className="mt-4 text-sm text-gray-500">
            {loadingStage === 'round' && 'Setting up round information...'}
            {loadingStage === 'fixtures' && 'Loading match fixtures...'}
            {loadingStage === 'results' && 'Calculating team scores and standings...'}
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

  const storeFinalTotalsForLadder = async (allTeamScores, round) => {
    try {
      // Extract just the Final Total values from the team scores
      const finalTotals = {};
      allTeamScores.forEach(team => {
        finalTotals[team.userId] = team.totalScore || 0; // This should be the finalScore
      });
      
      console.log(`Storing Final Totals for round ${round} for ladder:`, finalTotals);
      
      // Store these values so the ladder can use them
      const response = await fetch('/api/final-totals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round: round,
          allFinalTotals: finalTotals
        })
      });
      
      if (response.ok) {
        console.log(`Successfully stored Final Totals for round ${round}`);
      } else {
        console.warn(`Failed to store Final Totals for round ${round}`);
      }
      
    } catch (error) {
      console.error(`Error storing Final Totals for round ${round}:`, error);
    }
  };

  // Calculate all team scores using the simplified data
  const allTeamScores = useMemo(() => calculateAllTeamScores(), [calculateAllTeamScores]);

  // Store final totals for ladder (only when round or scores change, not on every render)
  useEffect(() => {
    if (displayedRound && allTeamScores.length > 0) {
      storeFinalTotalsForLadder(allTeamScores, displayedRound);
    }
  }, [displayedRound, allTeamScores]);

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
      // For regular rounds and finals, generate team cards in matchup order
      return orderedFixtures.flatMap((fixture) => {
        const homeUserId = fixture.home?.toString();
        const awayUserId = fixture.away?.toString();
        
        // Skip if not numeric IDs or TBD placeholders
        if (!homeUserId || !awayUserId || 
            homeUserId === 'TBD' || awayUserId === 'TBD' ||
            isNaN(Number(homeUserId)) || isNaN(Number(awayUserId))) {
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
      {/* Mobile-optimized header */}
      <div className="block sm:hidden mb-4">
        <select 
          id="round-select-mobile"
          value={displayedRound || ""}
          onChange={handleRoundChange}
          className="w-full p-3 border rounded-lg text-base text-black bg-white"
        >
          {[...Array(25)].map((_, i) => (
            <option key={i} value={i}>
              {displayRoundName(i)}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop header */}
      <div className="hidden sm:flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-black">Team Scores</h1>
          <div className="w-full sm:w-auto flex items-center gap-2">
            <label htmlFor="round-select" className="text-sm font-medium text-black">Round:</label>
            <select 
              id="round-select"
              value={displayedRound || ""}
              onChange={handleRoundChange}
              className="p-2 border rounded w-32 text-sm text-black"
            >
              {[...Array(25)].map((_, i) => (
                <option key={i} value={i}>
                  {displayRoundName(i)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Link href="/pages/ladder" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          View Ladder
        </Link>
      </div>

      {/* Enhanced Round Summary Section */}
      <EnhancedRoundSummary 
        displayedRound={displayedRound}
        roundName={displayRoundName(displayedRound)}
        orderedFixtures={orderedFixtures}
        allTeamScores={allTeamScores}
        selectedUserId={selectedUserId}
        hasSubstitutions={hasSubstitutions}
        isFinals={isFinalRound(displayedRound)}
      />
      
      {/* Mobile Team Cards Section - 2-column compact layout */}
      <div className="block sm:hidden">
        <div className="grid grid-cols-2 gap-2">
          {getTeamCardsOrder().map(userId => {
            if (!userId || !USER_NAMES[userId]) return null;
            
            const userTeamScores = getTeamScores(userId);
            
            // Don't render if scores aren't calculated yet (prevents flashing)
            if (!userTeamScores || loading) {
              return (
                <div key={userId} className="bg-white rounded-lg shadow-md p-2">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-bold text-black truncate">{USER_NAMES[userId]}</h2>
                    <div className="text-right font-bold text-sm text-black">
                      Loading...
                    </div>
                  </div>
                </div>
              );
            }
            
            return (
              <MobileTeamScoreCard 
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

      {/* Desktop Team Cards Section - Original layout */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {getTeamCardsOrder().map(userId => {
            if (!userId || !USER_NAMES[userId]) return null;
            
            const userTeamScores = getTeamScores(userId);
            
            // Don't render if scores aren't calculated yet (prevents flashing)
            if (!userTeamScores || loading) {
              return (
                <div key={userId} className="bg-white rounded-lg shadow-md p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg sm:text-xl font-bold text-black">{USER_NAMES[userId]}</h2>
                    <div className="text-right font-bold text-lg border-t pt-2 text-black">
                      Final Total: Loading...
                    </div>
                  </div>
                </div>
              );
            }
            
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
    </div>
  );
}

// Mobile-optimized TeamScoreCard component
function MobileTeamScoreCard({ 
  userId, 
  userName, 
  teamScores, 
  isHighestScore, 
  isLowestScore,
  isSelectedUser,
  isRoundComplete
}) {
  return (
    <div className="bg-white rounded-lg shadow-md p-2 sm:p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <h2 className="text-sm sm:text-lg font-bold text-black truncate">{userName}</h2>
          {isHighestScore && <span className="text-yellow-500 text-xs sm:text-base">⭐</span>}
          {isLowestScore && <span className="text-red-500 text-xs sm:text-base">🦀</span>}
          {isSelectedUser && 
            <span className="text-xs px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs hidden sm:inline">Selected</span>}
        </div>
        <div className="text-right font-bold text-sm sm:text-lg text-black">
          {teamScores.finalScore}
        </div>
      </div>

      <div className="space-y-2 text-xs sm:text-sm">
        {/* Main Team Positions - Compact */}
        <div className="space-y-1">
          <h3 className="text-sm font-semibold border-b pb-1 text-black">Main Team</h3>
          {teamScores.positionScores.map((position) => {
            const didNotPlay = position.noStats || !position.player?.hasPlayed;
            const isReplaced = position.isBenchPlayer;
            const showDNP = isRoundComplete && didNotPlay;
            
            return (
              <div key={position.position} className="flex justify-between items-center py-1">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{position.position}</div>
                  <div className={`text-xs truncate ${(showDNP || isReplaced) ? 'text-red-600' : 'text-black'}`}>
                    {position.originalPlayerName || 'Not Selected'}
                    {isReplaced && (
                      <div className="text-green-600 text-xs">
                        → {position.playerName}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right ml-1">
                  <span className={`font-semibold ${showDNP || isReplaced ? "text-red-600" : ""}`}>
                    {position.originalScore || position.score}
                  </span>
                  {isReplaced && (
                    <div className="text-xs text-green-600 font-medium">
                      +{position.score}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Team Score + Dead Cert */}
        <div className="border-t pt-2 space-y-1">
          <div className="flex justify-between">
            <span className="font-medium text-black">Team Score:</span>
            <span className="font-semibold text-black">{teamScores.totalScore}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-black">Dead Cert:</span>
            <span className="font-semibold text-black">{teamScores.deadCertScore}</span>
          </div>
        </div>

        {/* Bench/Reserves - Very Compact */}
        <div className="bg-gray-50 p-2 rounded text-xs">
          <h3 className="text-xs font-semibold mb-1 text-black">Bench/Reserves</h3>
          {(!teamScores.benchScores || teamScores.benchScores.length === 0) ? (
            <div className="text-xs text-gray-600 italic">
              No bench or reserve players selected
            </div>
          ) : (
            teamScores.benchScores.map((bench) => {
              const showDNP = isRoundComplete && !bench.didPlay;
              const isBeingUsed = bench.isBeingUsed;
              
              return (
                <div key={bench.position} className="flex justify-between items-center">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs truncate">{bench.position}</div>
                    <div className={`text-xs truncate ${isBeingUsed ? 'text-green-600' : showDNP ? 'text-red-600' : 'text-black'}`}>
                      {bench.playerName}
                      {isBeingUsed && ' (Used)'}
                      {!isRoundComplete && !isBeingUsed && ' : Locked'}
                    </div>
                  </div>
                  <div className={`text-xs ${showDNP ? 'text-red-600' : isBeingUsed ? 'text-green-600' : 'text-black'}`}>
                    {bench.score}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
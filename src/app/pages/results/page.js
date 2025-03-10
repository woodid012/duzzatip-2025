'use client'

import React, { useState, useEffect } from 'react';

import { Star } from 'lucide-react';
import { GiCrab } from 'react-icons/gi';
import { useAppContext } from '@/app/context/AppContext';
import useResults from '@/app/hooks/useResults';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { isFinalRound, getFinalRoundName } from '@/app/lib/ladder_utils';
import { useUserContext } from '../layout';
import Link from 'next/link';

export default function ResultsPage() {
  // Get data from our app context
  const { currentRound, roundInfo, changeRound } = useAppContext();
  
  // Get the selected user from context
  const { selectedUserId } = useUserContext();
  
  // Get results functionality from our hook
  const {
    teams,
    loading,
    error,
    calculateAllTeamScores,
    getTeamScores
  } = useResults();

  // State for toggling visibility on mobile
  const [expandedTeams, setExpandedTeams] = useState({});
  const [fixtures, setFixtures] = useState([]);
  const [orderedFixtures, setOrderedFixtures] = useState([]);
  const [shouldShowWelcome, setShouldShowWelcome] = useState(false);
  
  // New state for the displayed round (might be different from the actual current round)
  const [displayedRound, setDisplayedRound] = useState(0);

  // Check if the round is complete based on roundEndTime
  const isRoundComplete = () => {
    if (!roundInfo.roundEndTime) return false;
    const now = new Date();
    const roundEnd = new Date(roundInfo.roundEndTime);
    return now > roundEnd;
  };

  // Set initial displayed round to 0 when page loads, regardless of the context's current round
  // We want to keep showing round 0 results until round 1 lockout passes
  useEffect(() => {
    // Check if we should show round 0 results
    // Either before round 0 lockout or between round 0 and round 1 lockout
    const showRound0 = roundInfo.currentRound === 0 || roundInfo.showResultsForRound0;
    
    if (showRound0) {
      setDisplayedRound(0);
      // Load round 0 data
      if (currentRound !== 0) {
        changeRound(0);
      }
    } else {
      // After round 1 lockout, sync with context's current round
      setDisplayedRound(currentRound);
    }
  }, [roundInfo, currentRound, changeRound]);

  // Check if we should display the welcome screen (Round 0) or auto-switch to Round 1
  useEffect(() => {
    // Show welcome screen only if we're on round 0 and it's not locked yet
    if (displayedRound === 0) {
      const isRound0Active = !roundInfo.isLocked;
      setShouldShowWelcome(isRound0Active);
    } else {
      setShouldShowWelcome(false);
    }
  }, [displayedRound, roundInfo]);

  // Get fixtures for the displayed round
  useEffect(() => {
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

  // Toggle team expansion
  const toggleTeamExpansion = (userId) => {
    setExpandedTeams(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }));
  };

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    setDisplayedRound(newRound);
    changeRound(newRound);
  };

  // Display round name
  const displayRoundName = (round) => {
    if (round === 0) return 'Opening Round';
    if (isFinalRound(round)) return getFinalRoundName(round);
    return `Round ${round}`;
  };

  // Helper function to render a team card
  const renderTeamCard = (userId) => {
    if (!userId || !USER_NAMES[userId]) return null;
    
    // Get scores for this user's team
    const teamScores = getTeamScores(userId);
    const isExpanded = expandedTeams[userId] !== false; // Default to expanded
    
    return (
      <div key={userId} className="bg-white rounded-lg shadow-md p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg sm:text-xl font-bold text-black">{USER_NAMES[userId]}</h2>
            {teamScores.finalScore === highestScore && highestScore > 0 && 
              <Star className="text-yellow-500" size={20} />}
            {teamScores.finalScore === lowestScore && lowestScore > 0 && 
              <GiCrab className="text-red-500" size={20} />}
            {userId === selectedUserId && 
              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">Selected</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right font-bold text-lg border-t pt-2 text-black">
              Final Total: {teamScores.finalScore}
            </div>
            <button 
              onClick={() => toggleTeamExpansion(userId)}
              className="text-gray-500 hover:text-black sm:hidden"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExpanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
              </svg>
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="space-y-4">
            <>
              {/* Main Team */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold border-b pb-2 text-black">Main Team</h3>
                <div className="hidden sm:grid grid-cols-12 gap-2 font-semibold text-sm pb-2 text-black">
                  <div className="col-span-2">Position</div>
                  <div className="col-span-3">Player</div>
                  <div className="col-span-5">Details</div>
                  <div className="col-span-2 text-right">Score</div>
                </div>
                {teamScores.positionScores.map((position) => (
                  <div key={position.position} className="border rounded p-2 sm:border-0 sm:p-0 sm:grid grid-cols-12 gap-2 text-sm text-black">
                    <div className="font-medium col-span-2 mb-1 sm:mb-0">{position.position}</div>
                    <div className="col-span-3 mb-1 sm:mb-0">
                      {isRoundComplete() && position.noStats ? (
                        <span className="text-red-600">{position.playerName} (DNP)</span>
                      ) : isRoundComplete() && position.isBenchPlayer ? (
                        <span className="text-green-600">
                          {position.replacementType}: {position.playerName}
                        </span>
                      ) : (
                        position.playerName || 'Not Selected'
                      )}
                    </div>
                    <div className="col-span-5 text-black text-xs sm:text-sm mb-1 sm:mb-0">
                      {isRoundComplete() && position.isBenchPlayer ? (
                        <div className="flex flex-col">
                          <span className="text-green-600">Auto-substitution from {position.replacementType}</span>
                          <span>{position.breakdown}</span>
                        </div>
                      ) : (
                        position.breakdown
                      )}
                    </div>
                    <div className="col-span-2 text-right font-semibold">
                      {position.score}
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Team Subtotal */}
              <div className="text-right font-semibold mt-2 text-black">
                Team Score: {teamScores.totalScore}
              </div>

              {/* Dead Certs */}
              <div className="space-y-2">
                <div className="text-right font-semibold text-black">
                  Dead Cert Bonus: {teamScores.deadCertScore}
                </div>
              </div>

              {/* Bench/Reserves */}
              <div className="space-y-2 bg-gray-50 p-2 sm:p-4 rounded">
                <h3 className="text-lg font-semibold border-b pb-2 text-black">Bench/Reserves</h3>
                {teamScores.benchScores.map((bench) => (
                  <div key={bench.position} className="border rounded p-2 sm:border-0 sm:p-0 sm:grid grid-cols-12 gap-2 text-sm text-black">
                    <div className="font-medium col-span-2 mb-1 sm:mb-0">
                      {bench.position}
                      {bench.position === 'Reserve A' && (
                        <div className="text-xs text-gray-500">Full Forward, Tall Forward, Ruck</div>
                      )}
                      {bench.position === 'Reserve B' && (
                        <div className="text-xs text-gray-500">Offensive, Mid, Tackler</div>
                      )}
                      {bench.backupPosition && (
                        <div className="text-xs text-gray-500">{bench.backupPosition}</div>
                      )}
                    </div>
                    <div className="col-span-3 mb-1 sm:mb-0">
                      {isRoundComplete() && !bench.didPlay ? (
                        <span className="text-red-600">{bench.playerName} (DNP)</span>
                      ) : isRoundComplete() && bench.isBeingUsed ? (
                        <span className="text-green-600">{bench.playerName}</span>
                      ) : (
                        bench.playerName
                      )}
                    </div>
                    <div className="col-span-5 text-black text-xs sm:text-sm mb-1 sm:mb-0">
                      {isRoundComplete() && bench.isBeingUsed ? (
                        <span className="text-green-600">
                          Replacing: {bench.replacingPlayerName} ({bench.replacingPosition})
                        </span>
                      ) : (
                        bench.breakdown
                      )}
                    </div>
                    <div className="col-span-2 text-right font-semibold">
                      {bench.score}
                    </div>
                  </div>
                ))}
              </div>
            </>
          </div>
        )}
      </div>
    );
  };

  // Welcome screen UI
  const renderWelcomeScreen = () => {
    // Get the setSelectedUserId function from context for the player dropdown
    const { setSelectedUserId } = useUserContext();
    
    // Format the lockout time safely
    const formattedLockoutTime = roundInfo.lockoutTime 
      ? `${roundInfo.lockoutTime}`
      : 'Not yet determined';
    
    // Handle player selection change  
    const handlePlayerChange = (e) => {
      const newUserId = e.target.value;
      if (typeof window !== 'undefined') {
        // Store in localStorage
        localStorage.setItem('selectedUserId', newUserId);
      }
      // Update context
      if (setSelectedUserId) {
        setSelectedUserId(newUserId);
      }
    };
      
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl w-full space-y-8 text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl sm:tracking-tight">
            Welcome to DuzzaTip {CURRENT_YEAR}
          </h1>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-8">
            <h2 className="text-2xl font-bold text-blue-800 mb-4">Opening Round Information</h2>
            
            <div className="text-blue-700 mb-6">
              <p className="mb-2">The competition begins with the Opening Round.</p>
              <p className="text-xl font-semibold mt-4">
                Lockout Time: {formattedLockoutTime}
              </p>
              <p className="mt-2">Make sure to submit your team before the lockout!</p>
            </div>
            
            <div className="mt-8 mb-6 flex justify-center">
              <div className="w-full max-w-xs">
                <label htmlFor="player-select" className="block text-sm font-medium text-blue-800 mb-2">
                  Select Your Player:
                </label>
                <select
                  id="player-select"
                  value={selectedUserId}
                  onChange={handlePlayerChange}
                  className="w-full p-3 border border-blue-300 rounded-md text-base text-black bg-white"
                >
                  <option value="">Select Player</option>
                  {Object.entries(USER_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/pages/team-selection" className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-lg font-medium">
                Enter Your Team
              </Link>
              
              <Link href="/pages/tipping" className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 text-lg font-medium">
                Enter Your Tips
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="p-4">Loading stats...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  // If we should show the welcome screen (Round 0 and not locked yet)
  if (shouldShowWelcome) {
    return renderWelcomeScreen();
  }

  // Calculate all team scores for determining highest and lowest
  const allTeamScores = calculateAllTeamScores();
  
  // Filter out any zero or undefined scores when determining highest/lowest
  const nonZeroScores = allTeamScores.filter(s => s.totalScore > 0);
  const highestScore = nonZeroScores.length > 0 ? Math.max(...nonZeroScores.map(s => s.totalScore)) : 0;
  const lowestScore = nonZeroScores.length > 0 ? Math.min(...nonZeroScores.map(s => s.totalScore)) : 0;

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

      {/* Round title and fixtures */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-4">{displayRoundName(displayedRound)}</h2>
        
        {displayedRound === 0 ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="text-lg font-semibold text-blue-800 mb-2">Opening Round Information</h3>
            <p className="text-blue-700 mb-4">Current team scores for the Opening Round:</p>
            
            {/* Display all teams with their scores for Opening Round */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
              {Object.entries(USER_NAMES).map(([userId, userName]) => {
                // Get the team score, treat null, undefined, NaN as 0
                const score = allTeamScores.find(s => s.userId === userId)?.totalScore || 0;
                
                // Only teams with scores > 0 should be considered for rankings
                const validScores = allTeamScores
                  .filter(s => (s.totalScore || 0) > 0)
                  .sort((a, b) => b.totalScore - a.totalScore);
                
                // Get rank of this team (only if they have a score > 0)
                const rank = score > 0 
                  ? validScores.findIndex(s => s.userId === userId) + 1 
                  : '-';
                  
                const isTopFour = rank !== '-' && rank <= 4;
                
                return (
                  <div key={userId} className={`${
                    isTopFour ? 'bg-green-50 border-green-200' : 'bg-white'
                  } rounded-lg shadow-md p-3`}>
                    <div className="text-center font-medium">
                      {userName}
                      {userId == selectedUserId && (
                        <span className="ml-2 text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="text-center text-2xl font-bold my-2">
                      {score}
                    </div>
                    <div className="text-center text-sm">
                      {score > 0 ? (
                        <span className="text-gray-600">
                          Rank: {rank}
                        </span>
                      ) : (
                        <span className="text-gray-600">
                          Score: 0
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : orderedFixtures && orderedFixtures.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {orderedFixtures.map((fixture, index) => {
              // Highlight the selected user's match
              const isSelectedUserMatch = selectedUserId && 
                (fixture.home == selectedUserId || fixture.away == selectedUserId);
              
              return (
                <div 
                  key={fixture.home + '-' + fixture.away} 
                  className={`${
                    isSelectedUserMatch 
                      ? 'bg-blue-50 border-blue-200' 
                      : 'bg-white'
                  } rounded-lg shadow-md p-3 order-${index}`}
                >
                  <div className="text-center text-sm text-gray-500 mb-2">
                    {isFinalRound(displayedRound) ? fixture.name || `Final ${index + 1}` : `Game ${index + 1}`}
                    {isSelectedUserMatch && (
                      <span className="ml-2 text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                        Your Match
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="text-center flex-1">
                      <div className={`font-medium ${fixture.home == selectedUserId ? 'text-blue-600 font-bold' : ''}`}>
                        {USER_NAMES[fixture.home] || fixture.home}
                      </div>
                      {allTeamScores.find(s => s.userId === String(fixture.home)) && (
                        <div className="text-2xl font-bold">
                          {allTeamScores.find(s => s.userId === String(fixture.home))?.totalScore || '-'}
                        </div>
                      )}
                    </div>
                    <div className="text-center text-gray-500 px-2">vs</div>
                    <div className="text-center flex-1">
                      <div className={`font-medium ${fixture.away == selectedUserId ? 'text-blue-600 font-bold' : ''}`}>
                        {USER_NAMES[fixture.away] || fixture.away}
                      </div>
                      {allTeamScores.find(s => s.userId === String(fixture.away)) && (
                        <div className="text-2xl font-bold">
                          {allTeamScores.find(s => s.userId === String(fixture.away))?.totalScore || '-'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-700">No fixtures available for this round.</p>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {displayedRound === 0 || (orderedFixtures && orderedFixtures.length > 0) ? (
          displayedRound === 0 ? (
            // For Opening Round, display all team cards sorted by score
            [...Object.entries(USER_NAMES)]
              .map(([userId]) => userId)
              .sort((a, b) => {
                // First prioritize the selected user
                if (a === selectedUserId) return -1;
                if (b === selectedUserId) return 1;
                
                // Then sort by score
                const scoreA = allTeamScores.find(s => s.userId === a)?.totalScore || 0;
                const scoreB = allTeamScores.find(s => s.userId === b)?.totalScore || 0;
                return scoreB - scoreA; // Sort descending
              })
              .map(userId => renderTeamCard(userId))
          ) : (
            // For regular rounds, display team cards in matchup order
            orderedFixtures.flatMap((fixture) => {
              const homeUserId = fixture.home?.toString();
              const awayUserId = fixture.away?.toString();
              
              // Skip if not numeric IDs (e.g., 'TBD' placeholders in finals)
              if (!homeUserId || !awayUserId || isNaN(Number(homeUserId)) || isNaN(Number(awayUserId))) {
                return [];
              }
              
              // If this is the selected user's fixture, prioritize their team card first
              if (selectedUserId && (homeUserId === selectedUserId || awayUserId === selectedUserId)) {
                if (homeUserId === selectedUserId) {
                  return [renderTeamCard(homeUserId), renderTeamCard(awayUserId)];
                } else {
                  return [renderTeamCard(awayUserId), renderTeamCard(homeUserId)];
                }
              }
              
              // Otherwise return both cards in normal order
              return [renderTeamCard(homeUserId), renderTeamCard(awayUserId)];
            })
          )
        ) : (
          // When no fixtures, display all team cards in default order
          Object.entries(USER_NAMES).map(([userId, userName]) => renderTeamCard(userId))
        )}
      </div>
      
      {/* Info about Reserves - Moved to bottom of page */}
      <div className="mt-10 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-semibold mb-2 text-blue-800">Reserve Rules</h3>
        <ul className="list-disc pl-5 text-blue-700 text-sm space-y-1">
          <li><strong>Reserve A</strong> is used as backup for: Full Forward, Tall Forward, and Ruck</li>
          <li><strong>Reserve B</strong> is used as backup for: Offensive, Midfielder, and Tackler</li>
          <li>If a player didn't play (DNP), their position will be filled by the appropriate reserve</li>
          <li>Each reserve player can only be used once (in case multiple players didn't play)</li>
          <li>Reserves are assigned to maximize total team score based on priority order:</li>
          <ol className="list-decimal pl-5 pt-1">
            <li>Specific backup position match (highest priority)</li>
            <li>Position type match (Reserve A for FF/TF/Ruck, Reserve B for others)</li>
            <li>Scoring potential (reserves are assigned to generate maximum points)</li>
          </ol>
        </ul>
      </div>
    </div>
  );
}
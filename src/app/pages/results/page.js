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

  // Check if we should display the welcome screen (Round 0) or auto-switch to Round 1
  useEffect(() => {
    // Check if we're on round 0 and if round 0 is still active
    if (currentRound === 0) {
      const isRound0Active = !roundInfo.isLocked;
      setShouldShowWelcome(isRound0Active);
      
      // If round 0 is locked, auto-switch to round 1
      if (!isRound0Active) {
        changeRound(1);
      }
    } else {
      setShouldShowWelcome(false);
    }
  }, [currentRound, roundInfo, changeRound]);

  // Get fixtures for the current round
  useEffect(() => {
    // Get fixtures for the current round
    const roundFixtures = getFixturesForRound(currentRound);
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
  }, [currentRound, selectedUserId]);

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
                    {position.noStats ? (
                      <span className="text-red-600">{position.playerName} (DNP)</span>
                    ) : position.isBenchPlayer ? (
                      <span className="text-green-600">
                        {position.replacementType}: {position.playerName}
                      </span>
                    ) : (
                      position.playerName || 'Not Selected'
                    )}
                  </div>
                  <div className="col-span-5 text-black text-xs sm:text-sm mb-1 sm:mb-0">
                    {position.isBenchPlayer ? (
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
                    {!bench.didPlay ? (
                      <span className="text-red-600">{bench.playerName} (DNP)</span>
                    ) : bench.isBeingUsed ? (
                      <span className="text-green-600">{bench.playerName}</span>
                    ) : (
                      bench.playerName
                    )}
                  </div>
                  <div className="col-span-5 text-black text-xs sm:text-sm mb-1 sm:mb-0">
                    {bench.isBeingUsed ? (
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
          </div>
        )}
      </div>
    );
  };

  // Convert Melbourne time (EST) to Perth time (AWST)
  const convertToAWST = (estTimeString) => {
    if (!estTimeString) return '';
    
    // Parse the EST time string - this assumes format like "31 March 2025 at 7:30 pm"
    try {
      const parts = estTimeString.match(/(\d+)\s+(\w+)\s+(\d{4})\s+at\s+(\d+):(\d+)\s+(am|pm)/i);
      if (!parts) return estTimeString;
      
      const [_, day, month, year, hour, minute, period] = parts;
      
      // Convert to 24-hour format
      let hours24 = parseInt(hour);
      if (period.toLowerCase() === 'pm' && hours24 !== 12) {
        hours24 += 12;
      } else if (period.toLowerCase() === 'am' && hours24 === 12) {
        hours24 = 0;
      }
      
      // Create date object
      const date = new Date(
        parseInt(year),
        getMonthNumber(month),
        parseInt(day),
        hours24,
        parseInt(minute)
      );
      
      // Subtract 2 hours for AWST (EST is +10, AWST is +8)
      const awstDate = new Date(date.getTime() - (2 * 60 * 60 * 1000));
      
      // Format to AWST time string
      const formattedHour = awstDate.getHours() % 12 || 12;
      const isPM = awstDate.getHours() >= 12;
      const formattedMinute = awstDate.getMinutes().toString().padStart(2, '0');
      
      // Handle date change (if we cross midnight going back 2 hours)
      const formattedDay = awstDate.getDate();
      const formattedMonth = getMonthName(awstDate.getMonth());
      const formattedYear = awstDate.getFullYear();
      
      const formattedTime = `${formattedDay} ${formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1)} ${formattedYear} at ${formattedHour}:${formattedMinute} ${isPM ? 'pm' : 'am'}`;
      
      return formattedTime;
    } catch (error) {
      console.error("Error converting time:", error);
      return estTimeString;
    }
  };
  
  // Helper function to convert month name to month number (0-11)
  const getMonthNumber = (monthName) => {
    const months = {
      'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
      'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
    };
    return months[monthName.toLowerCase()];
  };
  
  // Get month name from month number
  const getMonthName = (monthNumber) => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[monthNumber];
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
              <p className="mb-2">The competition will begin with the Opening Round.</p>
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
          
          <div className="mt-10 prose prose-lg max-w-none">
            <h3 className="text-xl font-semibold text-gray-800">How It Works</h3>
            <p className="text-gray-600">
              In the Opening Round, the top 4 scoring teams will be awarded a Win to start off the season.
              Results will be displayed here once all teams have been submitted and the round is locked.
            </p>
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
              value={currentRound}
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
        <h2 className="text-xl font-semibold mb-4">{displayRoundName(currentRound)}</h2>
        
        {currentRound === 0 ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="text-lg font-semibold text-blue-800 mb-2">Opening Round Rules</h3>
            <p className="text-blue-700">The top 4 scoring teams will be awarded a Win for the Opening Round.</p>
            
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
                        isTopFour ? (
                          <span className="text-green-600 font-semibold">
                            Rank: {rank} - Win
                          </span>
                        ) : (
                          <span className="text-gray-600">
                            Rank: {rank}
                          </span>
                        )
                      ) : (
                        <span className="text-red-600">
                          No team submitted
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
                    {isFinalRound(currentRound) ? fixture.name || `Final ${index + 1}` : `Game ${index + 1}`}
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
        {currentRound === 0 || (orderedFixtures && orderedFixtures.length > 0) ? (
          currentRound === 0 ? (
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
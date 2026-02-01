"use client";

import React, { useState, useEffect } from 'react';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';
import { useAppContext } from '@/app/context/AppContext';

const TippingResultsGrid = () => {
  const { currentRound, roundInfo, getSpecificRoundInfo, selectedYear } = useAppContext();
  const [selectedRound, setSelectedRound] = useState(currentRound.toString());
  const [fixtures, setFixtures] = useState([]);
  const [allUserTips, setAllUserTips] = useState({});
  const [yearTotals, setYearTotals] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedRoundInfo, setSelectedRoundInfo] = useState(null);
  const [isLockoutPassed, setIsLockoutPassed] = useState(false);
  
  // Mobile view states
  const [isMobile, setIsMobile] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  
  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Update selectedRound when currentRound changes
  useEffect(() => {
    setSelectedRound(currentRound.toString());
  }, [currentRound]);
  
  // Get round info for the selected round
  useEffect(() => {
    if (getSpecificRoundInfo) {
      const roundInfo = getSpecificRoundInfo(parseInt(selectedRound));
      setSelectedRoundInfo(roundInfo);
      
      // Check if lockout has passed for this round
      const now = new Date();
      const lockoutDate = roundInfo?.lockoutDate;
      
      // Consider the lockout passed if:
      // 1. There's no lockout date (safety check)
      // 2. Current time is past the lockout
      // 3. We're looking at an earlier round (historical data)
      const hasLockoutPassed = !lockoutDate || 
                              now > new Date(lockoutDate) || 
                              parseInt(selectedRound) < currentRound;
                              
      setIsLockoutPassed(hasLockoutPassed);
    }
  }, [selectedRound, getSpecificRoundInfo, currentRound]);

  useEffect(() => {
    const loadAllResults = async () => {
      setLoading(true);
      setError(null);

      try {
        // Load fixtures first
        const fixturesResponse = await fetch(`/api/tipping-data?year=${selectedYear}`);
        if (!fixturesResponse.ok) throw new Error('Failed to load fixtures');
        const fixtureData = await fixturesResponse.json();

        const fixturesArray = Array.isArray(fixtureData) ? fixtureData : fixtureData.fixtures || [];
        const roundFixtures = fixturesArray.filter(f => f.RoundNumber.toString() === selectedRound)
          .sort((a, b) => a.MatchNumber - b.MatchNumber);
        setFixtures(roundFixtures);

        // Load tips for all users
        const userTipsPromises = Object.keys(USER_NAMES).map(userId =>
          Promise.all([
            fetch(`/api/tipping-results?round=${selectedRound}&userId=${userId}&year=${selectedYear}`).then(res => res.json()),
            fetch(`/api/tipping-results?year=${selectedYear}&userId=${userId}`).then(res => res.json())
          ])
        );

        const allResults = await Promise.all(userTipsPromises);
        const tipsMap = {};
        const yearTotalsMap = {};
        
        allResults.forEach(([roundResult, yearResult], index) => {
          const userId = Object.keys(USER_NAMES)[index];
          
          // Process the matches and add default home team selections if needed
          const processedMatches = roundResult.completedMatches.map(match => {
            // If there's no tip, use the home team as default
            if (!match.tip) {
              return {
                ...match,
                tip: match.homeTeam,
                isDefault: true
              };
            }
            return match;
          });
          
          tipsMap[userId] = {
            matches: processedMatches,
            correctTips: roundResult.correctTips,
            deadCertScore: roundResult.deadCertScore,
            totalScore: roundResult.totalScore
          };
          
          yearTotalsMap[userId] = {
            correctTips: yearResult.correctTips,
            deadCertScore: yearResult.deadCertScore
          };
        });

        setAllUserTips(tipsMap);
        setYearTotals(yearTotalsMap);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadAllResults();
  }, [selectedRound]);

  const displayRound = (round) => {
    return round === '0' ? 'Opening Round' : `Round ${round}`;
  };

  const getWinningTeam = (fixture) => {
    if (fixture.HomeTeamScore === null || fixture.AwayTeamScore === null) return null;
    if (fixture.HomeTeamScore > fixture.AwayTeamScore) return fixture.HomeTeam;
    if (fixture.AwayTeamScore > fixture.HomeTeamScore) return fixture.AwayTeam;
    return 'Draw';
  };
  
  // Function to convert team names to abbreviations
  const getTeamAbbreviation = (teamName) => {
    if (!teamName) return '';
    
    // Common AFL team abbreviations
    const abbreviations = {
      'Adelaide': 'ADE',
      'Brisbane Lions': 'BRL',
      'Brisbane': 'BRL',
      'Carlton': 'CAR',
      'Collingwood': 'COL',
      'Essendon': 'ESS',
      'Fremantle': 'FRE',
      'Geelong': 'GEE',
      'Gold Coast': 'GCS',
      'Greater Western Sydney': 'GWS',
      'GWS Giants': 'GWS',
      'Hawthorn': 'HAW',
      'Melbourne': 'MEL',
      'North Melbourne': 'NTH',
      'Port Adelaide': 'PTA',
      'Richmond': 'RIC',
      'St Kilda': 'STK',
      'Sydney': 'SYD',
      'West Coast': 'WCE',
      'Western Bulldogs': 'WBD',
      'Bulldogs': 'WBD'
    };
    
    // Try to find the exact match first
    if (abbreviations[teamName]) {
      return abbreviations[teamName];
    }
    
    // If no exact match, try to find a partial match
    for (const [team, abbr] of Object.entries(abbreviations)) {
      if (teamName.includes(team)) {
        return abbr;
      }
    }
    
    // If no match found, return the first 3 letters
    return teamName.substring(0, 3).toUpperCase();
  };

  // Get sorted users for leaderboard
  const getSortedUsers = () => {
    return Object.entries(USER_NAMES)
      .sort((a, b) => {
        // Sort by year tips (highest first)
        const aTips = yearTotals[a[0]]?.correctTips || 0;
        const bTips = yearTotals[b[0]]?.correctTips || 0;
        
        // If tied on correctTips, sort by deadCertScore
        if (bTips === aTips) {
          return (yearTotals[b[0]]?.deadCertScore || 0) - (yearTotals[a[0]]?.deadCertScore || 0);
        }
        
        return bTips - aTips;
      });
  };

  // Check if we're in an active round (between lockout and end of round)
  const isActiveRound = () => {
    if (!selectedRoundInfo || parseInt(selectedRound) !== currentRound) return false;
    
    const now = new Date();
    const lockoutDate = selectedRoundInfo?.lockoutDate;
    
    // We're in active round if lockout has passed but round isn't completely finished
    // (assuming round is active for some period after lockout)
    return lockoutDate && now > new Date(lockoutDate);
  };

  if (loading) return (
    <div className="p-4 sm:p-8 text-center">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto mb-4"></div>
      Loading results...
    </div>
  );
  
  if (error) return (
    <div className="p-4 sm:p-8 text-center text-red-600">
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        Error: {error}
      </div>
    </div>
  );

  return (
    <div className="w-full">
      {/* Mobile View */}
      <div className="block md:hidden">
        <MobileTippingResults 
          selectedRound={selectedRound}
          setSelectedRound={setSelectedRound}
          displayRound={displayRound}
          selectedRoundInfo={selectedRoundInfo}
          isLockoutPassed={isLockoutPassed}
          fixtures={fixtures}
          allUserTips={allUserTips}
          yearTotals={yearTotals}
          getSortedUsers={getSortedUsers}
          getTeamAbbreviation={getTeamAbbreviation}
          getWinningTeam={getWinningTeam}
          isActiveRound={isActiveRound}
          currentRound={currentRound}
        />
      </div>

      {/* Desktop View */}
      <div className="hidden md:block">
        <DesktopTippingResults 
          selectedRound={selectedRound}
          setSelectedRound={setSelectedRound}
          displayRound={displayRound}
          selectedRoundInfo={selectedRoundInfo}
          isLockoutPassed={isLockoutPassed}
          fixtures={fixtures}
          allUserTips={allUserTips}
          yearTotals={yearTotals}
          getSortedUsers={getSortedUsers}
          getTeamAbbreviation={getTeamAbbreviation}
          getWinningTeam={getWinningTeam}
          currentRound={currentRound}
        />
      </div>
    </div>
  );
};

// Mobile Component
function MobileTippingResults({
  selectedRound,
  setSelectedRound,
  displayRound,
  selectedRoundInfo,
  isLockoutPassed,
  fixtures,
  allUserTips,
  yearTotals,
  getSortedUsers,
  getTeamAbbreviation,
  getWinningTeam,
  isActiveRound,
  currentRound
}) {
  // Default to fixtures tab if we're in an active round, otherwise leaderboard
  const [activeTab, setActiveTab] = useState(() => {
    return isActiveRound() ? 'fixtures' : 'leaderboard';
  });

  return (
    <div className="p-3 space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg p-4 shadow">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-black">Tip Results</h1>
            <select 
              value={selectedRound}
              onChange={(e) => setSelectedRound(e.target.value)}
              className="border rounded p-2 text-sm text-black bg-white"
            >
              {Array.from({ length: 25 }, (_, i) => (
                <option key={i} value={i.toString()} className="text-black">
                  {displayRound(i.toString())}
                </option>
              ))}
            </select>
          </div>
          
          <div className="text-sm font-medium text-black">
            {displayRound(selectedRound)}
          </div>
          
          {/* Lockout status */}
          {selectedRoundInfo && (
            <div className="text-xs">
              <span className="font-medium">Lockout: </span>
              <span className={isLockoutPassed ? "text-green-600" : "text-red-600"}>
                {selectedRoundInfo.lockoutTime || "Not set"} 
                {isLockoutPassed ? " (Passed)" : " (Not yet passed)"}
              </span>
              {!isLockoutPassed && (
                <div className="text-gray-600 mt-1">
                  Tips will be visible after lockout
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex">
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`flex-1 py-3 px-4 text-sm font-medium rounded-tl-lg ${
              activeTab === 'leaderboard'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Leaderboard
          </button>
          <button
            onClick={() => setActiveTab('fixtures')}
            className={`flex-1 py-3 px-4 text-sm font-medium rounded-tr-lg ${
              activeTab === 'fixtures'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Fixtures & Tips
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'leaderboard' && (
        <MobileLeaderboard 
          getSortedUsers={getSortedUsers}
          yearTotals={yearTotals}
          allUserTips={allUserTips}
          currentRound={currentRound}
          selectedRound={selectedRound}
        />
      )}

      {activeTab === 'fixtures' && (
        <MobileFixtures 
          fixtures={fixtures}
          getTeamAbbreviation={getTeamAbbreviation}
          getWinningTeam={getWinningTeam}
          allUserTips={allUserTips}
          getSortedUsers={getSortedUsers}
          isLockoutPassed={isLockoutPassed}
        />
      )}
    </div>
  );
}

// Mobile Leaderboard Component
function MobileLeaderboard({ getSortedUsers, yearTotals, allUserTips, currentRound, selectedRound }) {
  const isCurrentRound = parseInt(selectedRound) === currentRound;
  
  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-black">Season Leaderboard</h2>
      </div>
      <div className="divide-y">
        {getSortedUsers().map(([userId, userName], index) => {
          const userResults = allUserTips[userId];
          return (
            <div key={userId} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-yellow-500 text-white' :
                  index === 1 ? 'bg-gray-400 text-white' :
                  index === 2 ? 'bg-orange-600 text-white' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {index + 1}
                </div>
                <div>
                  <div className="font-medium text-black">{userName}</div>
                  <div className="text-xs text-gray-500">
                    {isCurrentRound ? (
                      <>
                        Current Round: {userResults?.correctTips || 0} Tips
                        {userResults?.deadCertScore !== 0 && (
                          <span className={userResults?.deadCertScore > 0 ? "text-green-600" : "text-red-600"}>
                            , {userResults?.deadCertScore > 0 ? "+" : ""}{userResults?.deadCertScore || 0} DCs
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        Round: {userResults?.correctTips || 0}
                        {userResults?.deadCertScore !== 0 && (
                          <span className={userResults?.deadCertScore > 0 ? "text-green-600" : "text-red-600"}>
                            {userResults?.deadCertScore > 0 ? " +" : " "}{userResults?.deadCertScore || 0}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-lg text-black">
                  {yearTotals[userId]?.correctTips || 0}
                </div>
                {yearTotals[userId]?.deadCertScore !== 0 && (
                  <div className={`text-sm ${yearTotals[userId]?.deadCertScore > 0 ? "text-green-600" : "text-red-600"}`}>
                    {yearTotals[userId]?.deadCertScore > 0 ? "+" : ""}{yearTotals[userId]?.deadCertScore || 0}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Mobile Fixtures Component
function MobileFixtures({ fixtures, getTeamAbbreviation, getWinningTeam, allUserTips, getSortedUsers, isLockoutPassed }) {
  return (
    <div className="space-y-4">
      {fixtures.map(fixture => {
        const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
        const winner = getWinningTeam(fixture);
        
        return (
          <div key={fixture.MatchNumber} className="bg-white rounded-lg shadow">
            {/* Fixture Header */}
            <div className="p-4 border-b">
              <div className="text-sm text-gray-600 mb-3">Game {fixture.MatchNumber}</div>
              
              <div className="grid grid-cols-3 gap-4 items-center">
                {/* Home Team */}
                <div className="text-center">
                  <div className={`font-medium text-lg ${
                    isMatchCompleted 
                      ? (winner === fixture.HomeTeam ? 'text-green-600' : 'text-black')
                      : 'text-blue-600'
                  }`}>
                    {getTeamAbbreviation(fixture.HomeTeam)}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">HOME</div>
                  <div className="text-xl font-bold">
                    {fixture.HomeTeamScore ?? '-'}
                  </div>
                </div>
                
                {/* VS */}
                <div className="text-center">
                  <div className="text-gray-400 font-medium">VS</div>
                  {isMatchCompleted && (
                    <div className="text-xs text-green-600 font-medium mt-1">
                      Winner: {getTeamAbbreviation(winner)}
                    </div>
                  )}
                </div>
                
                {/* Away Team */}
                <div className="text-center">
                  <div className={`font-medium text-lg ${
                    isMatchCompleted 
                      ? (winner === fixture.AwayTeam ? 'text-green-600' : 'text-black')
                      : 'text-black'
                  }`}>
                    {getTeamAbbreviation(fixture.AwayTeam)}
                  </div>
                  <div className="text-xs text-gray-500 mb-1">AWAY</div>
                  <div className="text-xl font-bold">
                    {fixture.AwayTeamScore ?? '-'}
                  </div>
                </div>
              </div>
            </div>

            {/* Player Tips */}
            <div className="p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Player Tips</h4>
              <div className="space-y-2">
                {getSortedUsers().map(([userId, userName]) => {
                  const userResults = allUserTips[userId];
                  const matchTip = userResults?.matches?.find(m => m.matchNumber === fixture.MatchNumber);
                  const isCorrect = matchTip?.correct;
                  const isDeadCert = matchTip?.deadCert;
                  const isDefault = matchTip?.isDefault;
                  
                  return (
                    <div key={userId} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-black w-20 truncate">
                          {userName}
                        </span>
                        {isDeadCert && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            isMatchCompleted ? 
                              (isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') :
                              'bg-yellow-100 text-yellow-700'
                          }`}>
                            {isMatchCompleted ? 
                              (isCorrect ? '+6' : '-12') :
                              'DC'
                            }
                          </span>
                        )}
                      </div>
                      
                      <div className="text-right">
                        {isLockoutPassed ? (
                          <span className={`text-sm font-medium ${
                            isMatchCompleted ? 
                              (isCorrect ? 'text-green-600' : 'text-red-600') :
                              (matchTip?.tip === fixture.HomeTeam ? 'text-blue-600' : 'text-black')
                          }`}>
                            {matchTip?.tip ? getTeamAbbreviation(matchTip.tip) : '-'}
                            {isDefault && <span className="text-xs text-gray-500 ml-1">(Def)</span>}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500 italic">Locked</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Mobile Individual Tips Component
function MobileIndividualTips({ 
  getSortedUsers, 
  selectedUser, 
  setSelectedUser, 
  allUserTips, 
  fixtures, 
  getTeamAbbreviation, 
  getWinningTeam, 
  isLockoutPassed 
}) {
  return (
    <div className="space-y-4">
      {/* User Selection */}
      <div className="bg-white rounded-lg shadow p-4">
        <label className="block text-sm font-medium text-black mb-2">Select Player:</label>
        <select
          value={selectedUser}
          onChange={(e) => setSelectedUser(e.target.value)}
          className="w-full border rounded p-2 text-black bg-white"
        >
          <option value="">Choose a player</option>
          {getSortedUsers().map(([userId, userName]) => (
            <option key={userId} value={userId}>
              {userName}
            </option>
          ))}
        </select>
      </div>

      {/* Individual Tips */}
      {selectedUser && allUserTips[selectedUser] && (
        <div className="space-y-3">
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold text-black mb-2">
              {USER_NAMES[selectedUser]}'s Tips
            </h3>
            <div className="text-sm text-gray-600">
              Round Score: {allUserTips[selectedUser]?.correctTips || 0}
              {allUserTips[selectedUser]?.deadCertScore !== 0 && (
                <span className={allUserTips[selectedUser]?.deadCertScore > 0 ? "text-green-600" : "text-red-600"}>
                  {allUserTips[selectedUser]?.deadCertScore > 0 ? " +" : " "}{allUserTips[selectedUser]?.deadCertScore || 0}
                </span>
              )}
            </div>
          </div>

          {fixtures.map(fixture => {
            const matchTip = allUserTips[selectedUser]?.matches?.find(m => m.matchNumber === fixture.MatchNumber);
            const isCorrect = matchTip?.correct;
            const isDeadCert = matchTip?.deadCert;
            const isDefault = matchTip?.isDefault;
            const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
            
            return (
              <div key={fixture.MatchNumber} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-sm text-gray-600">Game {fixture.MatchNumber}</div>
                  {isDeadCert && (
                    <div className={`text-xs px-2 py-1 rounded ${
                      isMatchCompleted ? 
                        (isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800') :
                        'bg-yellow-100 text-yellow-800'
                    }`}>
                      {isMatchCompleted ? 
                        (isCorrect ? '+6' : '-12') :
                        'DC'
                      }
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-3 gap-4 items-center">
                  {/* Home Team */}
                  <div className="text-center">
                    <div className={`font-medium ${
                      matchTip?.tip === fixture.HomeTeam ? 
                        (isCorrect ? 'text-green-600' : isMatchCompleted ? 'text-red-600' : 'text-blue-600') :
                        (isMatchCompleted ? 'text-black' : 'text-blue-600')
                    }`}>
                      {getTeamAbbreviation(fixture.HomeTeam)}
                      {matchTip?.tip === fixture.HomeTeam && (
                        <span className="ml-1 text-xs">
                          {isLockoutPassed ? '✓' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">HOME</div>
                    <div className="text-lg font-bold">
                      {fixture.HomeTeamScore ?? '-'}
                    </div>
                  </div>
                  
                  {/* VS */}
                  <div className="text-center">
                    <div className="text-gray-400 font-medium">VS</div>
                    {isLockoutPassed ? (
                      <div className="text-xs mt-1">
                        {matchTip?.tip ? (
                          <span className={`font-medium ${
                            isMatchCompleted ? 
                              (isCorrect ? 'text-green-600' : 'text-red-600') :
                              (matchTip?.tip === fixture.HomeTeam ? 'text-blue-600' : 'text-black')
                          }`}>
                            {getTeamAbbreviation(matchTip.tip)}
                            {isDefault && ' (Def)'}
                          </span>
                        ) : (
                          <span className="text-gray-500">No tip</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 mt-1">Locked</div>
                    )}
                  </div>
                  
                  {/* Away Team */}
                  <div className="text-center">
                    <div className={`font-medium ${
                      matchTip?.tip === fixture.AwayTeam ? 
                        (isCorrect ? 'text-green-600' : isMatchCompleted ? 'text-red-600' : 'text-black') :
                        (isMatchCompleted ? 'text-black' : 'text-black')
                    }`}>
                      {getTeamAbbreviation(fixture.AwayTeam)}
                      {matchTip?.tip === fixture.AwayTeam && (
                        <span className="ml-1 text-xs">
                          {isLockoutPassed ? '✓' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">AWAY</div>
                    <div className="text-lg font-bold">
                      {fixture.AwayTeamScore ?? '-'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Desktop Component (Original)
function DesktopTippingResults({
  selectedRound,
  setSelectedRound,
  displayRound,
  selectedRoundInfo,
  isLockoutPassed,
  fixtures,
  allUserTips,
  yearTotals,
  getSortedUsers,
  getTeamAbbreviation,
  getWinningTeam,
  currentRound
}) {
  const isCurrentRound = parseInt(selectedRound) === currentRound;
  
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h1 className="text-3xl font-bold text-black">Round Summary - {displayRound(selectedRound)}</h1>
          <select 
            value={selectedRound}
            onChange={(e) => setSelectedRound(e.target.value)}
            className="border rounded p-2 text-black"
          >
            {Array.from({ length: 25 }, (_, i) => (
              <option key={i} value={i.toString()} className="text-black">
                {displayRound(i.toString())}
              </option>
            ))}
          </select>
        </div>
        
        {/* Show lockout status */}
        {selectedRoundInfo && (
          <div className="mt-2 text-sm">
            <span className="font-medium">Lockout: </span>
            <span className={isLockoutPassed ? "text-green-600" : "text-red-600"}>
              {selectedRoundInfo.lockoutTime || "Not set"} 
              {isLockoutPassed ? " (Passed)" : " (Not yet passed)"}
            </span>
            {!isLockoutPassed && (
              <span className="ml-2 text-gray-600">
                • Tips will be visible after lockout
              </span>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border">
          <thead>
            <tr>
              <th className="py-2 px-4 border sticky left-0 bg-gray-100 z-10 text-black" rowSpan={3}>Team</th>
              <th className="py-2 px-4 border bg-gray-100 text-black" rowSpan={3}>Total (Year) | (Round)</th>
              {fixtures.map(fixture => {
                const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
                
                return (
                  <th key={fixture.MatchNumber} className={`py-1 px-2 border text-center text-black ${isMatchCompleted ? 'bg-green-50' : 'bg-gray-100'}`}>
                    Game {fixture.MatchNumber}
                  </th>
                );
              })}
            </tr>
            <tr className="bg-gray-50">
              {fixtures.map(fixture => {
                const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
                
                return (
                  <td key={`h-${fixture.MatchNumber}`} className={`py-1 px-2 border text-center whitespace-nowrap ${
                    isMatchCompleted ? 'bg-green-50 text-black' : 'bg-gray-50 text-blue-600'
                  }`}>
                    H - {getTeamAbbreviation(fixture.HomeTeam)} ({fixture.HomeTeamScore ?? '-'})
                  </td>
                );
              })}
            </tr>
            <tr className="bg-gray-50">
              {fixtures.map(fixture => {
                const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
                
                return (
                  <td key={`a-${fixture.MatchNumber}`} className={`py-1 px-2 border text-center whitespace-nowrap ${
                    isMatchCompleted ? 'bg-green-50 text-black' : 'bg-gray-50 text-black'
                  }`}>
                    A - {getTeamAbbreviation(fixture.AwayTeam)} ({fixture.AwayTeamScore ?? '-'})
                    <div className="text-xs font-medium">
                      {isMatchCompleted && 
                        <span className="text-green-600">W - {getTeamAbbreviation(getWinningTeam(fixture))}</span>
                      }
                    </div>
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {getSortedUsers().map(([userId, userName]) => {
              const userResults = allUserTips[userId];
              return (
                <tr key={userId} className="hover:bg-gray-50">
                  <td className="py-2 px-4 border sticky left-0 bg-white z-10 font-medium text-black">
                    {userName}
                  </td>
                  <td className="py-2 px-4 border text-center font-medium">
                    <div className="flex flex-col sm:flex-row justify-center items-center gap-1">
                      <span className="text-black">
                        {yearTotals[userId]?.correctTips || 0}
                      </span>
                      {yearTotals[userId]?.deadCertScore !== 0 && (
                        <span className={yearTotals[userId]?.deadCertScore > 0 ? "text-green-600" : "text-red-600"}>
                          ({yearTotals[userId]?.deadCertScore > 0 ? "+" : ""}{yearTotals[userId]?.deadCertScore || 0})
                        </span>
                      )}
                      <span className="text-gray-400 mx-1">|</span>
                      <span className="text-gray-700">
                        {isCurrentRound ? (
                          <>
                            {userResults?.correctTips || 0} Tips
                            {userResults?.deadCertScore !== 0 && (
                              <span className={userResults?.deadCertScore > 0 ? "text-green-600" : "text-red-600"}>
                                , {userResults?.deadCertScore > 0 ? "+" : ""}{userResults?.deadCertScore || 0} DCs
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {userResults?.correctTips || 0}
                            {userResults?.deadCertScore !== 0 && (
                              <span className={userResults?.deadCertScore > 0 ? "text-green-600" : "text-red-600"}>
                                ({userResults?.deadCertScore > 0 ? "+" : ""}{userResults?.deadCertScore || 0})
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  </td>
                  {fixtures.map(fixture => {
                    const matchTip = userResults?.matches?.find(m => m.matchNumber === fixture.MatchNumber);
                    const isCorrect = matchTip?.correct;
                    const isDeadCert = matchTip?.deadCert;
                    const isDefault = matchTip?.isDefault;
                    
                    // Determine if the match has been completed
                    const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
                    
                    return (
                      <td key={fixture.MatchNumber} className="py-2 px-4 border text-center">
                        <div 
                          className={`
                            ${isMatchCompleted ? 
                              (isCorrect ? 'text-green-600' : 'text-red-600') : 
                              (matchTip?.tip === fixture.HomeTeam ? 'text-blue-600' : 'text-black')
                            }
                            ${!matchTip?.tip ? 'text-black' : ''}
                            ${isDefault ? 'italic text-gray-500' : 'font-medium'}
                          `}
                        >
                          {/* Check if lockout has passed before showing tips */}
                          {isLockoutPassed ? (
                            <>
                              {matchTip?.tip ? getTeamAbbreviation(matchTip.tip) : '-'}
                              {isDefault && <span className="ml-1">(Def)</span>}
                              {isDeadCert && (
                                <span className="ml-1 text-sm font-medium">
                                  {isMatchCompleted ? 
                                    <span className={isCorrect ? 'text-green-600' : 'text-red-600'}>
                                      ({isCorrect ? '+6' : '-12'})
                                    </span> : 
                                    <span className="text-yellow-600">(DC)</span>
                                  }
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-500 italic">Locked</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TippingResultsGrid;
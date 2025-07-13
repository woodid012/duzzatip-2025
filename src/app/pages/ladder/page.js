'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { USER_NAMES } from '@/app/lib/constants';
import { useAppContext } from '@/app/context/AppContext';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { useUserContext } from '../layout';
import { Star, RefreshCw, AlertCircle } from 'lucide-react';
import { GiCrab } from 'react-icons/gi';

export default function LadderPage() {
  // Get selected user context and app context
  const { selectedUserId } = useUserContext();
  const { currentRound, roundInfo } = useAppContext();
  
  // Determine which round to show by default
  const getDefaultRound = () => {
    // If we don't have round info yet, default to 1
    if (!roundInfo || currentRound === undefined) return 1;
    
    // If current round lockout has passed, show current round
    if (roundInfo.isLocked) {
      return currentRound;
    }
    
    // If lockout hasn't passed, show the previous completed round
    return Math.max(1, currentRound - 1);
  };
  
  // State for the round we're viewing the ladder for
  const [selectedRound, setSelectedRound] = useState(getDefaultRound());
  
  // State for ladder data
  const [ladder, setLadder] = useState([]);
  const [currentRoundResults, setCurrentRoundResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // TEMPORARY: State for storage rebuild
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState('');
  const [rebuildComplete, setRebuildComplete] = useState(false);
  
  // State for YTD star/crab totals
  const [ytdStarCrabTotals, setYtdStarCrabTotals] = useState({});
  const [loadingStarCrabs, setLoadingStarCrabs] = useState(false);

  // State for team forms
  const [teamForms, setTeamForms] = useState({});
  const [loadingForms, setLoadingForms] = useState(false);

  // State for next fixtures
  const [nextFixtures, setNextFixtures] = useState({});

  // Mobile view states
  const [isMobile, setIsMobile] = useState(false);
  
  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update selectedRound when roundInfo changes (for initial load and lockout changes)
  useEffect(() => {
    if (roundInfo && currentRound !== undefined) {
      const defaultRound = getDefaultRound();
      if (selectedRound !== defaultRound && selectedRound === 1) {
        // Only auto-update if we're still on the initial default
        setSelectedRound(defaultRound);
      }
    }
  }, [roundInfo, currentRound]);

  // Calculate ladder using database storage approach but with better error handling
  const calculateLadder = async (upToRound) => {
    setLoading(true);
    setError(null);
    
    try {
      console.log(`Fetching ladder for round ${upToRound} using database storage approach`);
      
      // First try to get cached ladder data
      const getResponse = await fetch(`/api/ladder?round=${upToRound}`);
      
      if (getResponse.ok) {
        const data = await getResponse.json();
        
        if (data.standings && data.standings.length > 0) {
          setLadder(data.standings);
          console.log(`Ladder loaded from ${data.fromCache ? 'cache' : 'fresh calculation'} for round ${upToRound}`);
          
          // Get current round results for star/crab display
          await calculateCurrentRoundResults(upToRound);
          return;
        }
      }
      
      // If GET failed, try forcing recalculation
      console.log(`GET failed, forcing recalculation for round ${upToRound}`);
      const postResponse = await fetch(`/api/ladder?round=${upToRound}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round: upToRound,
          forceRecalculate: true
        })
      });
      
      if (!postResponse.ok) {
        throw new Error('Failed to fetch ladder data from both GET and POST');
      }
      
      const data = await postResponse.json();
      
      if (data.standings && data.standings.length > 0) {
        setLadder(data.standings);
        console.log(`Ladder loaded via forced recalculation for round ${upToRound}`);
      } else {
        console.warn(`No ladder data available for round ${upToRound}`);
        setLadder([]);
      }
      
      // Get current round results for star/crab display
      await calculateCurrentRoundResults(upToRound);
      
    } catch (error) {
      console.error('Error fetching ladder:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Calculate current round results for star/crab indicators
  // Replace the calculateCurrentRoundResults function in your ladder page with this:

// Calculate current round results for star/crab indicators using stored Final Totals
const calculateCurrentRoundResults = async (round) => {
  try {
    console.log(`Getting stored Final Totals for round ${round} display`);
    
    // Get the stored Final Totals from the database (same source as ladder calculation)
    const response = await fetch(`/api/final-totals?round=${round}`);
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.finalTotals && Object.keys(data.finalTotals).length > 0) {
        console.log(`Using stored Final Totals for round ${round} display:`, data.finalTotals);
        setCurrentRoundResults(data.finalTotals);
        return;
      }
    }
    
    // Fallback: if no stored Final Totals, calculate live (but this should rarely happen)
    console.log(`No stored Final Totals found for round ${round}, calculating live as fallback`);
    const results = {};
    
    // Get results for all users in this round (including dead certs)
    for (const userId of Object.keys(USER_NAMES)) {
      try {
        // Get team score
        const roundResultsRes = await fetch(`/api/round-results?round=${round}&userId=${userId}`);
        let teamScore = 0;
        if (roundResultsRes.ok) {
          const userData = await roundResultsRes.json();
          teamScore = userData.total || 0;
        }

        // Get dead cert score
        let deadCertScore = 0;
        try {
          const tippingRes = await fetch(`/api/tipping-results?round=${round}&userId=${userId}`);
          if (tippingRes.ok) {
            const tippingData = await tippingRes.json();
            deadCertScore = tippingData.deadCertScore || 0;
          }
        } catch (tippingError) {
          // Silent fail for tipping results
        }

        // Total score = team score + dead cert score
        results[userId] = teamScore + deadCertScore;
        
      } catch (error) {
        results[userId] = 0;
      }
    }
    
    setCurrentRoundResults(results);
    
  } catch (error) {
    console.error('Error calculating current round results:', error);
    setCurrentRoundResults({});
  }
};

  // Load YTD star/crab totals
  const calculateYTDStarCrabs = async (upToRound) => {
    setLoadingStarCrabs(true);
    
    try {
      const totals = {};
      
      // Initialize totals for all teams
      Object.keys(USER_NAMES).forEach(userId => {
        totals[userId] = { stars: 0, crabs: 0 };
      });

      // Calculate for rounds 1 through selectedRound
      for (let round = 1; round <= Math.min(upToRound, 21); round++) {
        const roundResults = {};
        
        // Get results for all users in this round (including dead certs)
        for (const userId of Object.keys(USER_NAMES)) {
          try {
            // Get team score
            const roundResultsRes = await fetch(`/api/round-results?round=${round}&userId=${userId}`);
            let teamScore = 0;
            if (roundResultsRes.ok) {
              const userData = await roundResultsRes.json();
              teamScore = userData.total || 0;
            }

            // Get dead cert score
            let deadCertScore = 0;
            try {
              const tippingRes = await fetch(`/api/tipping-results?round=${round}&userId=${userId}`);
              if (tippingRes.ok) {
                const tippingData = await tippingRes.json();
                deadCertScore = tippingData.deadCertScore || 0;
              }
            } catch (tippingError) {
              console.error(`Error getting tipping results for user ${userId} round ${round}:`, tippingError);
            }

            // Total score = team score + dead cert score
            roundResults[userId] = teamScore + deadCertScore;
            
          } catch (error) {
            roundResults[userId] = 0;
          }
        }

        const scores = Object.entries(roundResults)
          .map(([userId, score]) => ({ userId, score: Number(score) }))
          .filter(s => s.score > 0); // Only consider teams with scores > 0

        if (scores.length === 0) continue;

        // Find highest and lowest scores for this round
        const maxScore = Math.max(...scores.map(s => s.score));
        const minScore = Math.min(...scores.map(s => s.score));

        // Award stars and crabs
        scores.forEach(({ userId, score }) => {
          if (score === maxScore && maxScore > 0) {
            totals[userId].stars += 1;
          }
          if (score === minScore && minScore > 0 && minScore < maxScore) {
            totals[userId].crabs += 1;
          }
        });
      }

      console.log('YTD Star/Crab totals calculated:', totals);
      setYtdStarCrabTotals(totals);
      
    } catch (error) {
      console.error('Error calculating YTD star/crab totals:', error);
    } finally {
      setLoadingStarCrabs(false);
    }
  };

  // Load team forms (last 5 results)
  const calculateTeamForms = async (upToRound) => {
    setLoadingForms(true);
    
    try {
      const forms = {};
      
      // Initialize forms for all teams
      Object.keys(USER_NAMES).forEach(userId => {
        forms[userId] = [];
      });

      // Get results for rounds leading up to selected round
      const formRounds = [];
      for (let round = Math.max(1, upToRound - 4); round <= upToRound; round++) {
        formRounds.push(round);
      }

      // Process each round's results to determine W/L/D for each team
      for (const round of formRounds) {
        const roundResults = {};
        
        // Get results for all users in this round
        for (const userId of Object.keys(USER_NAMES)) {
          try {
            const roundResultsRes = await fetch(`/api/round-results?round=${round}&userId=${userId}`);
            if (roundResultsRes.ok) {
              const userData = await roundResultsRes.json();
              roundResults[userId] = userData.total || 0;
            } else {
              roundResults[userId] = 0;
            }
          } catch (error) {
            roundResults[userId] = 0;
          }
        }
        
        const fixtures = getFixturesForRound(round);
        
        // Process each fixture
        fixtures.forEach(fixture => {
          const homeUserId = String(fixture.home);
          const awayUserId = String(fixture.away);
          
          if (!roundResults[homeUserId] || !roundResults[awayUserId]) {
            return;
          }
          
          const homeScore = Number(roundResults[homeUserId]);
          const awayScore = Number(roundResults[awayUserId]);
          
          // Determine result for each team
          if (homeScore > awayScore) {
            // Home win, away loss
            forms[homeUserId].push({ result: 'W', round, score: homeScore, opponent: USER_NAMES[awayUserId] });
            forms[awayUserId].push({ result: 'L', round, score: awayScore, opponent: USER_NAMES[homeUserId] });
          } else if (awayScore > homeScore) {
            // Away win, home loss
            forms[awayUserId].push({ result: 'W', round, score: awayScore, opponent: USER_NAMES[homeUserId] });
            forms[homeUserId].push({ result: 'L', round, score: homeScore, opponent: USER_NAMES[awayUserId] });
          } else {
            // Draw
            forms[homeUserId].push({ result: 'D', round, score: homeScore, opponent: USER_NAMES[awayUserId] });
            forms[awayUserId].push({ result: 'D', round, score: awayScore, opponent: USER_NAMES[homeUserId] });
          }
        });
      }

      // Sort each team's form by round and keep only last 5
      Object.keys(forms).forEach(userId => {
        forms[userId] = forms[userId]
          .sort((a, b) => a.round - b.round)
          .slice(-5); // Keep only last 5 results
      });

      setTeamForms(forms);
      
    } catch (error) {
      console.error('Error calculating team forms:', error);
    } finally {
      setLoadingForms(false);
    }
  };

  // Calculate next fixtures
  useEffect(() => {
    const calculateNextFixtures = () => {
      const nextRound = selectedRound + 1;
      const fixtures = getFixturesForRound(nextRound);
      const nextOpponents = {};
      
      fixtures.forEach(fixture => {
        const homeUserId = String(fixture.home);
        const awayUserId = String(fixture.away);
        
        if (USER_NAMES[homeUserId] && USER_NAMES[awayUserId]) {
          nextOpponents[homeUserId] = {
            opponent: USER_NAMES[awayUserId],
            isHome: true,
            round: nextRound
          };
          nextOpponents[awayUserId] = {
            opponent: USER_NAMES[homeUserId],
            isHome: false,
            round: nextRound
          };
        }
      });
      
      setNextFixtures(nextOpponents);
    };

    if (selectedRound) {
      calculateNextFixtures();
    }
  }, [selectedRound]);

  // Calculate all data when round changes
  useEffect(() => {
    if (selectedRound) {
      calculateLadder(selectedRound);
      calculateYTDStarCrabs(selectedRound);
      calculateTeamForms(selectedRound);
    }
  }, [selectedRound]);

  // Find best and worst scores for current round
  const [highestScore, setHighestScore] = useState(0);
  const [lowestScore, setLowestScore] = useState(0);
  const [mostStars, setMostStars] = useState([]);
  const [mostCrabs, setMostCrabs] = useState([]);

  // Find players with the most stars and crabs YTD
  useEffect(() => {
    if (ytdStarCrabTotals && Object.keys(ytdStarCrabTotals).length > 0) {
      const maxStars = Math.max(...Object.values(ytdStarCrabTotals).map(t => t.stars));
      const maxCrabs = Math.max(...Object.values(ytdStarCrabTotals).map(t => t.crabs));
      
      const usersWithMostStars = Object.entries(ytdStarCrabTotals)
        .filter(([_, totals]) => totals.stars === maxStars && maxStars > 0)
        .map(([userId]) => userId);
        
      const usersWithMostCrabs = Object.entries(ytdStarCrabTotals)
        .filter(([_, totals]) => totals.crabs === maxCrabs && maxCrabs > 0)
        .map(([userId]) => userId);
      
      setMostStars(usersWithMostStars);
      setMostCrabs(usersWithMostCrabs);
    }
  }, [ytdStarCrabTotals]);

  // Calculate current round highest/lowest scores
  useEffect(() => {
    if (currentRoundResults && Object.keys(currentRoundResults).length > 0) {
      const scores = Object.values(currentRoundResults).filter(score => score > 0);
      
      if (scores.length > 0) {
        setHighestScore(Math.max(...scores));
        setLowestScore(Math.min(...scores));
      }
    }
  }, [currentRoundResults]);

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    setSelectedRound(newRound);
  };

  // Function to render form string
  const renderForm = (form) => {
    if (!form || form.length === 0) return '-';
    
    return form.map((game, index) => {
      const colorClass = game.result === 'W' ? 'text-green-600' : 
                        game.result === 'L' ? 'text-red-600' : 
                        'text-yellow-600';
      
      return (
        <span key={index} className={`${colorClass} font-mono font-bold`} title={`Round ${game.round}: ${game.result} vs ${game.opponent} (${game.score})`}>
          {game.result}
        </span>
      );
    }).reduce((prev, curr, index) => [prev, <span key={`sep-${index}`} className="text-gray-400 mx-1">·</span>, curr]);
  };

  // Get team's current round score
  const getTeamCurrentRoundScore = (userId) => {
    return currentRoundResults[userId]?.total || 0;
  };

  // Helper functions for finals
  const isFinalRound = (round) => {
    return round >= 22 && round <= 24;
  };

  const getFinalRoundName = (round) => {
    switch (round) {
      case 22:
        return "Qualifying Finals";
      case 23:
        return "Preliminary Final";
      case 24:
        return "Grand Final";
      default:
        return `Round ${round}`;
    }
  };


  // Refresh function
  const refreshLadder = () => {
    calculateLadder(selectedRound);
    calculateYTDStarCrabs(selectedRound);
    calculateTeamForms(selectedRound);
  };
  // Display loading state
  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <RefreshCw className="animate-spin h-6 w-6 mr-2" />
        Loading ladder...
      </div>
    );
  }
  
  // Display error state
  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            <span className="text-red-800">Error: {error}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      
      {/* Mobile View */}
      <div className="block md:hidden">
        <MobileLadder 
          selectedRound={selectedRound}
          handleRoundChange={handleRoundChange}
          ladder={ladder}
          currentRoundResults={currentRoundResults}
          highestScore={highestScore}
          lowestScore={lowestScore}
          ytdStarCrabTotals={ytdStarCrabTotals}
          mostStars={mostStars}
          mostCrabs={mostCrabs}
          teamForms={teamForms}
          nextFixtures={nextFixtures}
          getTeamCurrentRoundScore={getTeamCurrentRoundScore}
          renderForm={renderForm}
          isFinalRound={isFinalRound}
          getFinalRoundName={getFinalRoundName}
          refreshLadder={refreshLadder}
        />
      </div>

      {/* Desktop View */}
      <div className="hidden md:block">
        <DesktopLadder 
          selectedRound={selectedRound}
          handleRoundChange={handleRoundChange}
          ladder={ladder}
          currentRoundResults={currentRoundResults}
          highestScore={highestScore}
          lowestScore={lowestScore}
          ytdStarCrabTotals={ytdStarCrabTotals}
          mostStars={mostStars}
          mostCrabs={mostCrabs}
          teamForms={teamForms}
          nextFixtures={nextFixtures}
          getTeamCurrentRoundScore={getTeamCurrentRoundScore}
          renderForm={renderForm}
          isFinalRound={isFinalRound}
          getFinalRoundName={getFinalRoundName}
          refreshLadder={refreshLadder}
        />
      </div>
    </div>
  );
}

// Mobile Ladder Component
function MobileLadder({
  selectedRound,
  handleRoundChange,
  ladder,
  currentRoundResults,
  highestScore,
  lowestScore,
  ytdStarCrabTotals,
  mostStars,
  mostCrabs,
  teamForms,
  nextFixtures,
  getTeamCurrentRoundScore,
  renderForm,
  isFinalRound,
  getFinalRoundName,
  refreshLadder
}) {
  return (
    <div className="p-3 space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg p-4 shadow">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-black">Season Ladder</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshLadder}
              className="p-2 text-gray-500 hover:text-black"
              title="Refresh ladder"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <select 
              value={selectedRound}
              onChange={handleRoundChange}
              className="border rounded p-2 text-sm text-black bg-white"
            >
              {[...Array(24)].map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Finals banner for rounds 22-24 */}
        {isFinalRound(selectedRound) && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
            <h2 className="text-lg font-semibold text-yellow-800">
              Finals Series: {getFinalRoundName(selectedRound)}
            </h2>
            <p className="text-yellow-700 text-sm">
              {selectedRound === 22 && "1st plays 2nd (Winner to Grand Final), 3rd plays 4th (Winner to Prelim Final)."}
              {selectedRound === 23 && "Loser from 1st vs 2nd plays Winner from 3rd vs 4th. Winner advances to Grand Final."}
              {selectedRound === 24 && "Grand Final - Winner from 1st vs 2nd plays Winner from Prelim Final!"}
            </p>
          </div>
        )}
      </div>

      {/* Ladder Cards */}
      <div className="space-y-3">
        {ladder.map((team, index) => {
          const currentRoundScore = getTeamCurrentRoundScore(team.userId);
          
          return (
            <div key={team.userId} className="bg-white rounded-lg shadow p-4">
              {/* Position and Team Name */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    index === 0 ? 'bg-yellow-500 text-white' :
                    index >= 1 && index <= 3 ? 'bg-blue-500 text-white' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {index + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-black">{team.userName}</span>
                      
                      {/* Current round star/crab indicators */}
                      {currentRoundResults[team.userId]?.total && 
                       currentRoundResults[team.userId]?.total === highestScore && 
                       highestScore > 0 && 
                        <Star className="text-yellow-500" size={14} />}
                      {currentRoundResults[team.userId]?.total && 
                       currentRoundResults[team.userId]?.total === lowestScore && 
                       lowestScore > 0 && highestScore !== lowestScore &&
                        <GiCrab className="text-red-500" size={14} />}
                    </div>
                    
                    {/* Record and Points */}
                    <div className="text-xs text-gray-600">
                      {team.wins}W-{team.losses}L-{team.draws}D • {team.points} pts
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-4 text-center text-xs">
                <div>
                  <div className="text-gray-600">Stars/Crabs</div>
                  <div className="flex items-center justify-center gap-2">
                    <span className={`font-medium ${mostStars.includes(team.userId) ? 'text-yellow-600 font-bold' : 'text-yellow-600'}`}>
                      ⭐ {ytdStarCrabTotals[team.userId]?.stars || 0}
                    </span>
                    <span className={`font-medium ${mostCrabs.includes(team.userId) ? 'text-red-600 font-bold' : 'text-red-600'}`}>
                      🦀 {ytdStarCrabTotals[team.userId]?.crabs || 0}
                    </span>
                  </div>
                </div>
                
                <div>
                  <div className="text-gray-600">For/Against</div>
                  <div className="font-medium text-black">
                    {team.pointsFor}/{team.pointsAgainst}
                  </div>
                </div>
                
                <div>
                  <div className="text-gray-600">Percentage</div>
                  <div className="font-medium text-black">{team.percentage}%</div>
                </div>
              </div>
              
              {/* Form and Next Opponent */}
              <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t text-xs">
                <div>
                  <div className="text-gray-600 mb-1">Form (Recent)</div>
                  <div className="flex items-center">
                    {renderForm(teamForms[team.userId])}
                  </div>
                </div>
                
                <div>
                  <div className="text-gray-600 mb-1">Next (R{selectedRound + 1})</div>
                  <div className="font-medium text-black">
                    {nextFixtures[team.userId] ? (
                      <span>
                        {nextFixtures[team.userId].isHome ? 'vs' : '@'} {nextFixtures[team.userId].opponent}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-black mb-2">Legend</h3>
        <div className="text-xs text-gray-600 space-y-1">
          <div><span className="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-2"></span> Minor Premiership</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2"></span> Finals positions (2-4)</div>
          <div className="flex items-center"><Star className="text-yellow-500 mr-1" size={12} /> Highest score this round / Most stars YTD</div>
          <div className="flex items-center"><GiCrab className="text-red-500 mr-1" size={12} /> Lowest score this round / Most crabs YTD</div>
          <div><span className="font-medium">Form:</span> W=Win, L=Loss, D=Draw (last 5 games)</div>
        </div>
      </div>
    </div>
  );
}

// Desktop Ladder Component
function DesktopLadder({
  selectedRound,
  handleRoundChange,
  ladder,
  currentRoundResults,
  highestScore,
  lowestScore,
  ytdStarCrabTotals,
  mostStars,
  mostCrabs,
  teamForms,
  nextFixtures,
  getTeamCurrentRoundScore,
  renderForm,
  isFinalRound,
  getFinalRoundName,
  refreshLadder
}) {
  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-black">Season Ladder</h1>
          
          <div className="w-full sm:w-auto flex items-center gap-2">
            <label htmlFor="round-select" className="text-sm font-medium text-black">Round:</label>
            <select 
              id="round-select"
              value={selectedRound}
              onChange={handleRoundChange}
              className="p-2 border rounded w-24 text-base text-black"
            >
              {[...Array(24)].map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
            <button
              onClick={refreshLadder}
              className="p-2 text-gray-500 hover:text-black border rounded"
              title="Refresh ladder"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Finals banner for rounds 22-24 */}
      {isFinalRound(selectedRound) && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h2 className="text-xl font-semibold text-yellow-800">
            Finals Series: {getFinalRoundName(selectedRound)}
          </h2>
          <p className="text-yellow-700">
            {selectedRound === 22 && "1st plays 2nd (Winner to Grand Final), 3rd plays 4th (Winner to Prelim Final)."}
            {selectedRound === 23 && "Loser from 1st vs 2nd plays Winner from 3rd vs 4th. Winner advances to Grand Final."}
            {selectedRound === 24 && "Grand Final - Winner from 1st vs 2nd plays Winner from Prelim Final!"}
          </p>
        </div>
      )}

      {/* Ladder table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pos</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">P</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">L</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">D</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Pts</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <Star className="inline text-yellow-500" size={14} />
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <GiCrab className="inline text-red-500" size={14} />
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PF (Ave)</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PA (Ave)</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">%</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                R{selectedRound}
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Form → Latest
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Up Next (R{selectedRound + 1})
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {ladder.map((team, index) => {
              const currentRoundScore = getTeamCurrentRoundScore(team.userId);
              
              return (
                <tr key={team.userId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {index + 1}
                    {index === 0 && <span className="ml-1 text-green-600">•</span>}
                    {index >= 1 && index <= 3 && <span className="ml-1 text-blue-600">•</span>}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    <div className="flex items-center gap-1">
                      {team.userName}
                      
                      {/* Show current round star/crab if applicable */}
                      {currentRoundResults[team.userId]?.total && 
                       currentRoundResults[team.userId]?.total === highestScore && 
                       highestScore > 0 && 
                        <Star className="text-yellow-500" size={16} />}
                      {currentRoundResults[team.userId]?.total && 
                       currentRoundResults[team.userId]?.total === lowestScore && 
                       lowestScore > 0 && highestScore !== lowestScore &&
                        <GiCrab className="text-red-500" size={16} />}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.played}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.wins}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.losses}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.draws}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center font-medium text-gray-900">{team.points}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center">
                    <div className="flex items-center justify-center">
                      <span className={`font-medium ${mostStars.includes(team.userId) ? 'text-yellow-600 font-bold' : 'text-yellow-600'}`}>
                        {ytdStarCrabTotals[team.userId]?.stars || 0}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center">
                    <div className="flex items-center justify-center">
                      <span className={`font-medium ${mostCrabs.includes(team.userId) ? 'text-red-600 font-bold' : 'text-red-600'}`}>
                        {ytdStarCrabTotals[team.userId]?.crabs || 0}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                    {team.pointsFor} {team.played > 0 && <span className="text-gray-400">({Math.round(team.pointsFor / team.played)})</span>}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                    {team.pointsAgainst} {team.played > 0 && <span className="text-gray-400">({Math.round(team.pointsAgainst / team.played)})</span>}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.percentage}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center font-medium text-gray-900">
                    {currentRoundScore}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center">
                    <div className="flex items-center justify-center">
                      {renderForm(teamForms[team.userId])}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-700">
                    {nextFixtures[team.userId] ? (
                      <span className="font-medium">
                        {nextFixtures[team.userId].opponent}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 text-sm text-gray-600">
        <div className="flex flex-wrap gap-4">
          <div><span className="inline-block w-2 h-2 rounded-full bg-green-600 mr-1"></span> Minor Prem.</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-blue-600 mr-1"></span> Finals positions (2-4)</div>
          <div className="flex items-center"><Star className="text-yellow-500 mr-1" size={16} /> Highest score for current round / Most star performances YTD</div>
          <div className="flex items-center"><GiCrab className="text-red-500 mr-1" size={16} /> Lowest score for current round / Most crab performances YTD</div>
        </div>
        <div className="mt-2">
          <span className="font-medium">Live Calculation:</span> Ladder is calculated live using the same scoring system as the Results page, including bench/reserve substitutions.
        </div>
      </div>
    </div>
  );
}
'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { USER_NAMES } from '@/app/lib/constants';
import useLadder from '@/app/hooks/useLadder';
import useResults from '@/app/hooks/useResults';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { useUserContext } from '../layout';
import { Star, RefreshCw, AlertCircle } from 'lucide-react';
import { GiCrab } from 'react-icons/gi';

export default function LadderPage() {
  // Get selected user context
  const { selectedUserId } = useUserContext();
  
  const { 
    ladder, 
    currentRoundResults,
    loading, 
    error, 
    changeRound, 
    isFinalRound, 
    getFinalRoundName,
    currentRound,
    lastUpdated,
    dataSource,
    refreshLadder,
    getTeamCurrentRoundScore,
    getTeamLadderPosition
  } = useLadder();

  // State for YTD star/crab totals
  const [ytdStarCrabTotals, setYtdStarCrabTotals] = useState({});
  const [loadingStarCrabs, setLoadingStarCrabs] = useState(false);

  // State for form data
  const [teamForms, setTeamForms] = useState({});
  const [loadingForms, setLoadingForms] = useState(false);

  // State for next fixtures
  const [nextFixtures, setNextFixtures] = useState({});

  // Mobile view states
  const [isMobile, setIsMobile] = useState(false);
  const [selectedRound, setSelectedRound] = useState(currentRound);
  
  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Sync selected round with current round
  useEffect(() => {
    if (currentRound !== undefined) {
      setSelectedRound(currentRound);
    }
  }, [currentRound]);

  // Load YTD star/crab totals
  useEffect(() => {
    const calculateYTDStarCrabs = async () => {
      setLoadingStarCrabs(true);
      
      try {
        const totals = {};
        
        // Initialize totals for all teams
        Object.keys(USER_NAMES).forEach(userId => {
          totals[userId] = { stars: 0, crabs: 0 };
        });

        // Fetch stored results for rounds 1 through selectedRound
        const roundPromises = [];
        for (let round = 1; round <= Math.min(selectedRound, 21); round++) {
          roundPromises.push(
            fetch(`/api/store-round-results?round=${round}`)
              .then(res => res.ok ? res.json() : null)
              .catch(() => null)
          );
        }

        const allRoundResults = await Promise.all(roundPromises);

        // Process each round's results
        allRoundResults.forEach((roundData, index) => {
          const round = index + 1;
          
          if (!roundData || !roundData.found || !roundData.results) {
            console.log(`No stored results found for round ${round}`);
            return;
          }

          const results = roundData.results;
          const scores = Object.entries(results)
            .map(([userId, score]) => ({ userId, score: Number(score) }))
            .filter(s => s.score > 0); // Only consider teams with scores > 0

          if (scores.length === 0) return;

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
        });

        console.log('YTD Star/Crab totals calculated:', totals);
        setYtdStarCrabTotals(totals);
        
      } catch (error) {
        console.error('Error calculating YTD star/crab totals:', error);
      } finally {
        setLoadingStarCrabs(false);
      }
    };

    if (selectedRound && selectedRound > 0) {
      calculateYTDStarCrabs();
    }
  }, [selectedRound]);

  // Load team forms (last 5 results)
  useEffect(() => {
    const calculateTeamForms = async () => {
      setLoadingForms(true);
      
      try {
        const forms = {};
        
        // Initialize forms for all teams
        Object.keys(USER_NAMES).forEach(userId => {
          forms[userId] = [];
        });

        // Get results for rounds leading up to selected round
        const formRounds = [];
        for (let round = Math.max(1, selectedRound - 4); round <= selectedRound; round++) {
          formRounds.push(round);
        }

        // Fetch results for form rounds
        const roundPromises = formRounds.map(round => 
          fetch(`/api/store-round-results?round=${round}`)
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
        );

        const formRoundResults = await Promise.all(roundPromises);

        // Process each round's results to determine W/L/D for each team
        formRoundResults.forEach((roundData, index) => {
          const round = formRounds[index];
          
          if (!roundData || !roundData.found || !roundData.results) {
            return;
          }

          const results = roundData.results;
          const fixtures = getFixturesForRound(round);
          
          // Process each fixture
          fixtures.forEach(fixture => {
            const homeUserId = String(fixture.home);
            const awayUserId = String(fixture.away);
            
            if (!results[homeUserId] || !results[awayUserId]) {
              return;
            }
            
            const homeScore = Number(results[homeUserId]);
            const awayScore = Number(results[awayUserId]);
            
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
        });

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

    if (selectedRound && selectedRound > 0) {
      calculateTeamForms();
    }
  }, [selectedRound]);

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
    changeRound(newRound);
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
          dataSource={dataSource}
          lastUpdated={lastUpdated}
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
          dataSource={dataSource}
          lastUpdated={lastUpdated}
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
  refreshLadder,
  dataSource,
  lastUpdated
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
        
        {/* Data source indicator */}
        <div className="text-xs text-gray-500 mb-3">
          Data: {dataSource === 'cached' ? 'Stored' : 'Live'} 
          {lastUpdated && ` • Updated: ${lastUpdated.toLocaleTimeString()}`}
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
                      {currentRoundResults[team.userId] && 
                       currentRoundResults[team.userId] === highestScore && 
                       highestScore > 0 && 
                        <Star className="text-yellow-500" size={14} />}
                      {currentRoundResults[team.userId] && 
                       currentRoundResults[team.userId] === lowestScore && 
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
  refreshLadder,
  dataSource,
  lastUpdated
}) {
  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-black">Season Ladder</h1>
          
          {/* Data source indicator */}
          <div className="flex items-center gap-2 text-sm">
            <div className="flex items-center text-blue-600">
              <RefreshCw className="h-4 w-4 mr-1" />
              {dataSource === 'cached' ? 'Stored Data' : 'Live Data'}
            </div>
            {lastUpdated && (
              <div className="text-gray-500">
                Updated: {lastUpdated.toLocaleTimeString()}
              </div>
            )}
          </div>
          
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
                      {currentRoundResults[team.userId] && 
                       currentRoundResults[team.userId] === highestScore && 
                       highestScore > 0 && 
                        <Star className="text-yellow-500" size={16} />}
                      {currentRoundResults[team.userId] && 
                       currentRoundResults[team.userId] === lowestScore && 
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
          <span className="font-medium">Auto Storage:</span> Results are automatically stored 1 week after round completion and match live calculations.
        </div>
      </div>
    </div>
  );
}
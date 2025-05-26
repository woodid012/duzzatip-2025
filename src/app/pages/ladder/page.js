'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { USER_NAMES } from '@/app/lib/constants';
import useLadder from '@/app/hooks/useLadder';
import useResults from '@/app/hooks/useResults';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { Star, RefreshCw, Database, Calculator, AlertCircle } from 'lucide-react';
import { GiCrab } from 'react-icons/gi';

export default function LadderPage() {
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
    recalculateLadder,
    calculateAndStoreCurrentRound,
    clearCachedData,
    getTeamCurrentRoundScore,
    getTeamLadderPosition
  } = useLadder();

  // Get live scoring system for current round comparison
  const {
    getTeamScores: getLiveTeamScores,
    loading: liveLoading,
    changeRound: changeLiveRound
  } = useResults();

  // State for admin functions
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [selectedRound, setSelectedRound] = useState(currentRound);

  // State for round comparison
  const [showComparison, setShowComparison] = useState(false);
  const [liveScores, setLiveScores] = useState({});

  // Sync selected round with current round
  useEffect(() => {
    if (currentRound !== undefined) {
      setSelectedRound(currentRound);
    }
  }, [currentRound]);

  // Load live scores for comparison when needed
  useEffect(() => {
    if (showComparison && !liveLoading) {
      const scores = {};
      Object.keys(USER_NAMES).forEach(userId => {
        const teamScore = getLiveTeamScores(userId);
        scores[userId] = teamScore?.finalScore || 0;
      });
      setLiveScores(scores);
    }
  }, [showComparison, liveLoading, getLiveTeamScores]);

  // Change live scoring round when selected round changes
  useEffect(() => {
    if (changeLiveRound && selectedRound !== undefined) {
      changeLiveRound(selectedRound);
    }
  }, [selectedRound, changeLiveRound]);

  // Find best and worst scores for current round
  const [highestScore, setHighestScore] = useState(0);
  const [lowestScore, setLowestScore] = useState(0);
  const [mostStars, setMostStars] = useState([]);
  const [mostCrabs, setMostCrabs] = useState([]);

  // Calculate star and crab totals for each team based on stored results
  const calculateStarCrabTotals = useMemo(() => {
    const totals = {};
    
    // Initialize totals for all teams
    Object.keys(USER_NAMES).forEach(userId => {
      totals[userId] = { stars: 0, crabs: 0 };
    });

    // For now, just use current round results
    // You can extend this to fetch historical round results from the database
    if (currentRoundResults && Object.keys(currentRoundResults).length > 0) {
      const scores = Object.entries(currentRoundResults).map(([userId, score]) => ({ userId, score }));
      
      if (scores.length > 0 && scores.some(s => s.score > 0)) {
        const maxScore = Math.max(...scores.map(s => s.score));
        const minScore = Math.min(...scores.filter(s => s.score > 0).map(s => s.score));
        
        setHighestScore(maxScore);
        setLowestScore(minScore);
        
        // Count stars and crabs for current round
        scores.forEach(({ userId, score }) => {
          if (score === maxScore && maxScore > 0) {
            totals[userId].stars += 1;
          }
          if (score === minScore && minScore > 0) {
            totals[userId].crabs += 1;
          }
        });
      }
    }
    
    return totals;
  }, [currentRoundResults]);

  // Find players with the most stars and crabs
  useEffect(() => {
    if (calculateStarCrabTotals && Object.keys(calculateStarCrabTotals).length > 0) {
      const maxStars = Math.max(...Object.values(calculateStarCrabTotals).map(t => t.stars));
      const maxCrabs = Math.max(...Object.values(calculateStarCrabTotals).map(t => t.crabs));
      
      const usersWithMostStars = Object.entries(calculateStarCrabTotals)
        .filter(([_, totals]) => totals.stars === maxStars && maxStars > 0)
        .map(([userId]) => userId);
        
      const usersWithMostCrabs = Object.entries(calculateStarCrabTotals)
        .filter(([_, totals]) => totals.crabs === maxCrabs && maxCrabs > 0)
        .map(([userId]) => userId);
      
      setMostStars(usersWithMostStars);
      setMostCrabs(usersWithMostCrabs);
    }
  }, [calculateStarCrabTotals]);

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    setSelectedRound(newRound);
    changeRound(newRound);
  };

  // Admin function to calculate and store current round
  const handleCalculateAndStore = async () => {
    setAdminLoading(true);
    setAdminMessage('');
    
    try {
      const result = await calculateAndStoreCurrentRound(true);
      setAdminMessage(`✅ ${result.message} (${result.userCount} users)`);
    } catch (error) {
      setAdminMessage(`❌ Error: ${error.message}`);
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin function to recalculate ladder
  const handleRecalculateLadder = async () => {
    setAdminLoading(true);
    setAdminMessage('');
    
    try {
      await recalculateLadder();
      setAdminMessage('✅ Ladder recalculated successfully');
    } catch (error) {
      setAdminMessage(`❌ Error: ${error.message}`);
    } finally {
      setAdminLoading(false);
    }
  };

  // Admin function to clear cached data
  const handleClearCache = async () => {
    if (!confirm('Are you sure you want to clear all cached data for this round?')) {
      return;
    }
    
    setAdminLoading(true);
    setAdminMessage('');
    
    try {
      await clearCachedData();
      setAdminMessage('✅ Cached data cleared successfully');
    } catch (error) {
      setAdminMessage(`❌ Error: ${error.message}`);
    } finally {
      setAdminLoading(false);
    }
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
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-black">Season Ladder</h1>
          
          {/* Data source indicator */}
          <div className="flex items-center gap-2 text-sm">
            {dataSource === 'cached' && (
              <div className="flex items-center text-green-600">
                <Database className="h-4 w-4 mr-1" />
                Cached Data
              </div>
            )}
            {dataSource === 'calculated' && (
              <div className="flex items-center text-blue-600">
                <Calculator className="h-4 w-4 mr-1" />
                Live Calculated
              </div>
            )}
            {dataSource === 'recalculated' && (
              <div className="flex items-center text-purple-600">
                <RefreshCw className="h-4 w-4 mr-1" />
                Recalculated
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
              {[...Array(25)].map((_, i) => (
                <option key={i} value={i}>{i === 0 ? 'Opening' : i}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Admin Panel Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
          >
            {showComparison ? 'Hide' : 'Show'} Live Comparison
          </button>
          <button
            onClick={() => setShowAdminPanel(!showAdminPanel)}
            className="px-3 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
          >
            Admin Panel
          </button>
        </div>
      </div>

      {/* Admin Panel */}
      {showAdminPanel && (
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <h3 className="text-lg font-semibold mb-3 text-gray-800">Admin Functions</h3>
          
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={handleCalculateAndStore}
              disabled={adminLoading}
              className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 text-sm flex items-center gap-1"
            >
              <Calculator className="h-4 w-4" />
              Calculate & Store Round {selectedRound}
            </button>
            
            <button
              onClick={handleRecalculateLadder}
              disabled={adminLoading}
              className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm flex items-center gap-1"
            >
              <RefreshCw className="h-4 w-4" />
              Recalculate Ladder
            </button>
            
            <button
              onClick={handleClearCache}
              disabled={adminLoading}
              className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 text-sm flex items-center gap-1"
            >
              <AlertCircle className="h-4 w-4" />
              Clear Cache
            </button>
          </div>
          
          {adminMessage && (
            <div className="text-sm text-gray-700 bg-white p-2 rounded border">
              {adminMessage}
            </div>
          )}
          
          {lastUpdated && (
            <div className="text-xs text-gray-500 mt-2">
              Last updated: {lastUpdated.toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* Live Comparison Panel */}
      {showComparison && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-lg font-semibold mb-3 text-blue-800">Live vs Stored Comparison (Round {selectedRound})</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium text-blue-700 mb-2">Stored Results:</h4>
              <div className="space-y-1">
                {Object.entries(currentRoundResults).map(([userId, score]) => (
                  <div key={userId} className="flex justify-between text-sm">
                    <span>{USER_NAMES[userId]}</span>
                    <span className="font-medium">{score}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div>
              <h4 className="font-medium text-blue-700 mb-2">Live Calculated:</h4>
              <div className="space-y-1">
                {Object.entries(liveScores).map(([userId, score]) => {
                  const storedScore = currentRoundResults[userId] || 0;
                  const difference = score - storedScore;
                  return (
                    <div key={userId} className="flex justify-between text-sm">
                      <span>{USER_NAMES[userId]}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{score}</span>
                        {difference !== 0 && (
                          <span className={`text-xs ${difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ({difference > 0 ? '+' : ''}{difference})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Finals banner for rounds 22-24 */}
      {isFinalRound(selectedRound) && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h2 className="text-xl font-semibold text-yellow-800">
            Finals Series: {getFinalRoundName(selectedRound)}
          </h2>
          <p className="text-yellow-700">
            {selectedRound === 22 && "Top team plays 4th, 2nd plays 3rd. Winners advance to preliminary & grand finals."}
            {selectedRound === 23 && "Winner from Qualifying Final 2 plays the loser from Qualifying Final 1."}
            {selectedRound === 24 && "Grand Final - Winner takes all!"}
          </p>
        </div>
      )}

      {/* Ladder table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pos</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">P</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">L</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">D</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PF (Ave)</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PA (Ave)</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">%</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                R{selectedRound}
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <Star className="inline text-yellow-500" size={14} />
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <GiCrab className="inline text-red-500" size={14} />
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Pts</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {ladder.map((team, index) => (
              <tr key={team.userId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {index + 1}
                  {index === 0 && <span className="ml-1 text-green-600">•</span>}
                  {index >= 1 && index <= 3 && <span className="ml-1 text-blue-600">•</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  <div className="flex items-center gap-1">
                    {team.userName}
                    
                    {/* Show current round star/crab if applicable */}
                    {currentRoundResults[team.userId] && 
                     currentRoundResults[team.userId] === highestScore && 
                     highestScore > 0 && 
                      <Star className="text-yellow-500" size={16} />}
                    {currentRoundResults[team.userId] && 
                     currentRoundResults[team.userId] === lowestScore && 
                     lowestScore > 0 && 
                      <GiCrab className="text-red-500" size={16} />}
                    
                    {/* Show indicators for most stars/crabs overall */}
                    {mostStars.includes(team.userId) && 
                      <Star className="text-yellow-500" size={16} />}
                    {mostCrabs.includes(team.userId) && 
                      <GiCrab className="text-red-500" size={16} />}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.played}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.wins}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.losses}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.draws}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                  {team.pointsFor} {team.played > 0 && <span className="text-gray-400">({Math.round(team.pointsFor / team.played)})</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                  {team.pointsAgainst} {team.played > 0 && <span className="text-gray-400">({Math.round(team.pointsAgainst / team.played)})</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.percentage}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-medium text-gray-900">
                  {getTeamCurrentRoundScore(team.userId)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                  <div className="flex items-center justify-center">
                    <span className={`font-medium ${mostStars.includes(team.userId) ? 'text-yellow-600 font-bold' : 'text-yellow-600'}`}>
                      {calculateStarCrabTotals[team.userId]?.stars || 0}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                  <div className="flex items-center justify-center">
                    <span className={`font-medium ${mostCrabs.includes(team.userId) ? 'text-red-600 font-bold' : 'text-red-600'}`}>
                      {calculateStarCrabTotals[team.userId]?.crabs || 0}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-medium text-gray-900">{team.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 text-sm text-gray-600">
        <div className="flex flex-wrap gap-4">
          <div><span className="inline-block w-2 h-2 rounded-full bg-green-600 mr-1"></span> Top position (automatic Grand Final)</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-blue-600 mr-1"></span> Finals positions (2-4)</div>
          <div className="flex items-center"><Star className="text-yellow-500 mr-1" size={16} /> Highest score for round / Most star performances overall</div>
          <div className="flex items-center"><GiCrab className="text-red-500 mr-1" size={16} /> Lowest score for round / Most crab performances overall</div>
        </div>
        <div className="mt-2">
          <span className="font-medium">P</span>: Played, 
          <span className="font-medium ml-2">W</span>: Wins, 
          <span className="font-medium ml-2">L</span>: Losses, 
          <span className="font-medium ml-2">D</span>: Draws, 
          <span className="font-medium ml-2">PF (Ave)</span>: Points For (Average per game), 
          <span className="font-medium ml-2">PA (Ave)</span>: Points Against (Average per game), 
          <span className="font-medium ml-2">%</span>: Percentage, 
          <span className="font-medium ml-2">R{selectedRound}</span>: Round {selectedRound} score,
          <span className="font-medium ml-2">
            <Star className="inline text-yellow-500 mb-1" size={14} />
          </span>: Total highest scores,
          <span className="font-medium ml-2">
            <GiCrab className="inline text-red-500 mb-1" size={14} />
          </span>: Total lowest scores,
          <span className="font-medium ml-2">Pts</span>: Ladder Points (Win: 4, Draw: 2, Loss: 0)
        </div>
      </div>
    </div>
  );
}
// src/app/pages/ladder/page.jsx

'use client';

import { useState, useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { USER_NAMES } from '@/app/lib/constants';

export default function LadderConsolidatedPage() {
  const { currentRound, selectedYear } = useAppContext();
  const [selectedRound, setSelectedRound] = useState(currentRound);
  const [ladderData, setLadderData] = useState([]);
  const [roundResults, setRoundResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState('');

  // Initialize selected round when currentRound is available
  useEffect(() => {
    if (currentRound !== undefined && selectedRound === undefined) {
      setSelectedRound(currentRound);
    }
  }, [currentRound, selectedRound]);

  // Load ladder data when round changes
  useEffect(() => {
    if (selectedRound !== undefined && selectedRound !== null) {
      loadLadderData(selectedRound);
    }
  }, [selectedRound, selectedYear]);

  const loadLadderData = async (round) => {
    try {
      setLoading(true);
      setError(null);

      console.log(`Loading ladder data for round ${round}`);

      // Get ladder from our new simple API
      const ladderResponse = await fetch(`/api/simple-ladder?round=${round}&year=${selectedYear}`);
      if (!ladderResponse.ok) {
        throw new Error('Failed to load ladder data');
      }

      const ladderResult = await ladderResponse.json();
      setLadderData(ladderResult.ladder || []);
      setLastUpdated(ladderResult.lastUpdated ? new Date(ladderResult.lastUpdated) : null);

      // Get current round results for display (still using consolidated for the round display)
      if (round > 0) {
        const roundResultsResponse = await fetch(`/api/consolidated-round-results?round=${round}&year=${selectedYear}`);
        if (roundResultsResponse.ok) {
          const data = await roundResultsResponse.json();
          setRoundResults(data.results || {});
        }
      }

    } catch (err) {
      console.error('Error loading ladder data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFullRefresh = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      setRefreshProgress('Starting refresh...');

      console.log('Starting full refresh of rounds 1-21');

      // Call our new API to refresh all rounds
      const response = await fetch('/api/simple-ladder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshAll: true })
      });

      if (!response.ok) {
        throw new Error('Failed to refresh ladder data');
      }

      const result = await response.json();
      console.log('Refresh result:', result);

      if (result.results) {
        const message = `Processed: ${result.results.processed.length} rounds\n` +
                       `Stored: ${result.results.stored.length} rounds\n` +
                       `Failed: ${result.results.failed.length} rounds`;
        
        setRefreshProgress(message);
        
        if (result.results.failed.length > 0) {
          console.warn(`Failed rounds: ${result.results.failed.join(', ')}`);
        }
      }

      // Reload the ladder
      await loadLadderData(selectedRound);

      setRefreshProgress('Refresh complete!');
      setTimeout(() => setRefreshProgress(''), 3000);

    } catch (err) {
      console.error('Error during refresh:', err);
      setError(`Refresh failed: ${err.message}`);
      setRefreshProgress('');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleQuickRefresh = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      setRefreshProgress(`Refreshing round ${selectedRound}...`);

      // Only refresh if it's a regular season round
      if (selectedRound >= 1 && selectedRound <= 21) {
        const response = await fetch('/api/simple-ladder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ round: selectedRound })
        });

        if (!response.ok) {
          throw new Error('Failed to refresh round');
        }

        const result = await response.json();
        console.log(`Round ${selectedRound} refresh result:`, result);
      }

      // Reload the ladder
      await loadLadderData(selectedRound);
      setRefreshProgress('');

    } catch (err) {
      console.error('Error during quick refresh:', err);
      setError(`Refresh failed: ${err.message}`);
      setRefreshProgress('');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleClearData = async () => {
    if (!confirm('This will clear all stored ladder data. Are you sure?')) {
      return;
    }

    try {
      setIsRefreshing(true);
      setRefreshProgress('Clearing all data...');

      const response = await fetch('/api/simple-ladder', {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to clear data');
      }

      const result = await response.json();
      alert(result.message);

      // Reload
      await loadLadderData(selectedRound);
      setRefreshProgress('');

    } catch (err) {
      console.error('Error clearing data:', err);
      setError(`Clear failed: ${err.message}`);
      setRefreshProgress('');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRoundChange = (e) => {
    setSelectedRound(Number(e.target.value));
  };

  const formatRoundName = (round) => {
    if (round === 0) return "Opening Round";
    if (round >= 22 && round <= 24) {
      if (round === 22) return 'Qualifying Finals';
      if (round === 23) return 'Preliminary Final';
      if (round === 24) return 'Grand Final';
    }
    return `Round ${round}`;
  };

  const getTeamCurrentRoundResult = (userId) => {
    const result = roundResults[userId];
    if (!result) return null;
    
    return {
      matchResult: result.matchResult,
      opponent: result.opponent,
      score: result.totalScore,
      opponentScore: result.opponentScore,
      isHome: result.isHome,
      hasStar: result.hasStar,
      hasCrab: result.hasCrab
    };
  };

  if (loading && !isRefreshing) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-center min-h-64">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto mb-4"></div>
            <div className="text-lg font-medium">Loading ladder...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !isRefreshing) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <h3 className="font-bold text-lg mb-2 text-red-800">Error Loading Ladder</h3>
          <p className="text-red-700">{error}</p>
          <button 
            onClick={() => loadLadderData(selectedRound)}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">Season Ladder</h1>
          <p className="text-gray-600">
            {selectedRound === 0 
              ? "Opening Round - No ladder yet" 
              : `After ${formatRoundName(selectedRound)}`}
          </p>
          {lastUpdated && (
            <p className="text-sm text-gray-500">
              Last updated: {lastUpdated.toLocaleString()}
            </p>
          )}
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor="round-select" className="text-sm font-medium text-black">
              Round:
            </label>
            <select 
              id="round-select"
              value={selectedRound || 0}
              onChange={handleRoundChange}
              className="p-2 border rounded text-sm text-black bg-white"
              disabled={isRefreshing}
            >
              {[...Array(25)].map((_, i) => (
                <option key={i} value={i}>
                  {formatRoundName(i)}
                </option>
              ))}
            </select>
          </div>
          
          <button
            onClick={handleQuickRefresh}
            disabled={isRefreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
            title="Refresh current round"
          >
            Quick Refresh
          </button>
          
          <button
            onClick={handleFullRefresh}
            disabled={isRefreshing}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            title="Refresh all rounds 1-21"
          >
            Full Refresh
          </button>
          
          <button
            onClick={handleClearData}
            disabled={isRefreshing}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400"
            title="Clear all stored data"
          >
            Clear Data
          </button>
        </div>
      </div>

      {/* Refresh Progress */}
      {refreshProgress && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="text-blue-800 font-semibold mb-2">Refresh Status</h3>
          <pre className="text-blue-700 whitespace-pre-wrap">{refreshProgress}</pre>
        </div>
      )}

      {/* Opening Round Message */}
      {selectedRound === 0 && !isRefreshing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="text-blue-800 font-semibold mb-2">Opening Round</h3>
          <p className="text-blue-700">
            The season ladder will begin after Round 1. The Opening Round is used for initial team rankings.
          </p>
        </div>
      )}

      {/* Desktop Ladder Table */}
      {!isRefreshing && (
        <div className="hidden md:block">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Pos
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Team
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      P
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      W
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      L
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      D
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      PF
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      PA
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      %
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Pts
                    </th>
                    {selectedRound > 0 && (
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {formatRoundName(selectedRound)}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {ladderData.map((team, index) => {
                    const currentRoundResult = getTeamCurrentRoundResult(team.userId);
                    const isTopFour = index < 4;
                    
                    return (
                      <tr 
                        key={team.userId} 
                        className={`hover:bg-gray-50 ${isTopFour ? 'bg-green-50' : ''}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`text-sm font-bold ${isTopFour ? 'text-green-700' : 'text-gray-900'}`}>
                            {index + 1}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{team.userName}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                          {team.played}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                          {team.wins}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                          {team.losses}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                          {team.draws}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                          {team.pointsFor}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                          {team.pointsAgainst}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                          {team.percentage}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className="text-sm font-bold text-gray-900">{team.points}</span>
                        </td>
                        {selectedRound > 0 && (
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            {currentRoundResult ? (
                              <div className="text-sm">
                                <div className="flex items-center justify-center gap-1">
                                  <span className={`font-medium ${
                                    currentRoundResult.matchResult === 'W' ? 'text-green-600' :
                                    currentRoundResult.matchResult === 'L' ? 'text-red-600' : 'text-gray-600'
                                  }`}>
                                    {currentRoundResult.matchResult}
                                  </span>
                                  <span className="text-gray-600">
                                    {currentRoundResult.score}
                                  </span>
                                  {currentRoundResult.hasStar && <span className="text-yellow-500">⭐</span>}
                                  {currentRoundResult.hasCrab && <span className="text-red-500">🦀</span>}
                                </div>
                                <div className="text-xs text-gray-500">
                                  vs {currentRoundResult.opponent} ({currentRoundResult.opponentScore})
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* Mobile Ladder Cards */}
      {!isRefreshing && (
        <div className="block md:hidden space-y-3">
          {ladderData.map((team, index) => {
            const currentRoundResult = getTeamCurrentRoundResult(team.userId);
            const isTopFour = index < 4;
            
            return (
              <div 
                key={team.userId}
                className={`rounded-lg p-4 shadow ${isTopFour ? 'bg-green-50 border-green-200' : 'bg-white'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isTopFour ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {index + 1}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{team.userName}</div>
                      <div className="text-sm text-gray-500">
                        {team.played} games • {team.points} points
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900">{team.percentage}%</div>
                    <div className="text-sm text-gray-500">{team.pointsFor}/{team.pointsAgainst}</div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-center text-sm">
                  <div>
                    <div className="text-gray-500">W-L-D</div>
                    <div className="font-medium">{team.wins}-{team.losses}-{team.draws}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Points</div>
                    <div className="font-bold">{team.points}</div>
                  </div>
                  {selectedRound > 0 && currentRoundResult && (
                    <div>
                      <div className="text-gray-500">{formatRoundName(selectedRound)}</div>
                      <div className="flex items-center justify-center gap-1">
                        <span className={`font-medium ${
                          currentRoundResult.matchResult === 'W' ? 'text-green-600' :
                          currentRoundResult.matchResult === 'L' ? 'text-red-600' : 'text-gray-600'
                        }`}>
                          {currentRoundResult.matchResult} {currentRoundResult.score}
                        </span>
                        {currentRoundResult.hasStar && <span className="text-yellow-500">⭐</span>}
                        {currentRoundResult.hasCrab && <span className="text-red-500">🦀</span>}
                      </div>
                    </div>
                  )}
                </div>
                
                {selectedRound > 0 && currentRoundResult && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-sm text-gray-600 text-center">
                      vs {currentRoundResult.opponent} ({currentRoundResult.opponentScore})
                      {currentRoundResult.isHome ? ' (H)' : ' (A)'}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Finals Info */}
      {selectedRound >= 21 && ladderData.length > 0 && !isRefreshing && (
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-blue-800 font-semibold mb-2">Finals Qualification</h3>
          <div className="text-blue-700">
            <p className="mb-2">Top 4 teams qualify for finals:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ladderData.slice(0, 4).map((team, index) => (
                <div key={team.userId} className="flex items-center gap-2">
                  <span className="font-medium">{index + 1}.</span>
                  <span>{team.userName}</span>
                  <span className="text-sm">({team.points} pts)</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
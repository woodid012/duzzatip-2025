// src/app/pages/tipping-ladder/page.jsx

'use client';

import { useState, useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';

export default function TippingLadderPage() {
  const { currentRound } = useAppContext();
  const [selectedRound, setSelectedRound] = useState(currentRound);
  const [ladderData, setLadderData] = useState([]);
  const [roundResults, setRoundResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Initialize selected round when currentRound is available
  useEffect(() => {
    if (currentRound !== undefined && selectedRound === undefined) {
      setSelectedRound(currentRound);
    }
  }, [currentRound, selectedRound]);

  // Load tipping ladder data when round changes
  useEffect(() => {
    if (selectedRound !== undefined && selectedRound !== null) {
      loadTippingLadder(selectedRound);
    }
  }, [selectedRound]);

  const loadTippingLadder = async (round) => {
    try {
      setLoading(true);
      setError(null);

      console.log(`Loading tipping ladder data for round ${round}`);

      // Use consolidated API for much faster loading
      const response = await fetch(`/api/consolidated-tipping-ladder?upToRound=${Math.min(round, 24)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to load tipping ladder: ${response.status}`);
      }

      const data = await response.json();
      
      // Transform data to match existing UI format
      const transformedLadder = data.ladder.map(user => ({
        userId: user.userId,
        userName: user.userName,
        yearCorrectTips: user.correctTips,
        yearTotalDCCount: user.totalDCCount,
        yearCorrectDCCount: user.correctDCCount,
        yearWrongDCCount: user.wrongDCCount,
        yearNetDCScore: user.netDCScore,
        roundCorrectTips: data.roundResults[round]?.[user.userId]?.correctTips || 0,
        roundTotalDCCount: 0, // Not calculated separately per round in new API
        roundCorrectDCCount: 0,
        roundWrongDCCount: 0,
        roundNetDCScore: data.roundResults[round]?.[user.userId]?.deadCertScore || 0
      }));
      
      setLadderData(transformedLadder);
      setRoundResults(data.roundResults);
      setLastUpdated(data.cached ? 
        `Cached: ${new Date(data.cachedAt).toLocaleString()}` : 
        new Date().toLocaleString()
      );

      console.log(`Loaded tipping ladder (${data.cached ? 'cached' : 'fresh'}) with ${data.ladder.length} users`);

    } catch (err) {
      console.error('Error loading tipping ladder:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRoundChange = (e) => {
    setSelectedRound(Number(e.target.value));
  };

  const formatRoundName = (round) => {
    if (round === 0) return "Opening Round";
    return `Round ${round}`;
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-center min-h-64">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto mb-4"></div>
            <div className="text-lg font-medium">Loading tipping ladder...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <h3 className="font-bold text-lg mb-2 text-red-800">Error Loading Tipping Ladder</h3>
          <p className="text-red-700">{error}</p>
          <button 
            onClick={() => loadTippingLadder(selectedRound)}
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
          <h1 className="text-2xl font-bold text-black">Tipping Ladder {CURRENT_YEAR}</h1>
          <p className="text-gray-600">
            Season standings after {formatRoundName(selectedRound)}
          </p>
          {lastUpdated && (
            <p className="text-sm text-gray-500">
              Last updated: {lastUpdated.toLocaleString()}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <label htmlFor="round-select" className="text-sm font-medium text-black">
            Round:
          </label>
          <select 
            id="round-select"
            value={selectedRound || 0}
            onChange={handleRoundChange}
            className="p-2 border rounded text-sm text-black bg-white"
          >
            {[...Array(25)].map((_, i) => (
              <option key={i} value={i}>
                {formatRoundName(i)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Desktop Ladder Table */}
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
                    Tipper
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50">
                    Season Tips
                  </th>
                  {selectedRound > 0 && (
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50">
                      Round {selectedRound} Tips
                    </th>
                  )}
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-orange-50">
                    Season DCs
                  </th>
                  {selectedRound > 0 && (
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-orange-50">
                      Round DCs
                    </th>
                  )}
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-orange-50">
                    Season Correct
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-orange-50">
                    Season Wrong
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-orange-50">
                    Season Net
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {ladderData.map((tipper, index) => {
                  const isLeader = index === 0;
                  const isTop3 = index < 3;
                  
                  return (
                    <tr 
                      key={tipper.userId} 
                      className={`hover:bg-gray-50 ${isLeader ? 'bg-yellow-50' : isTop3 ? 'bg-green-50' : ''}`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className={`text-sm font-bold flex items-center gap-2 ${
                          isLeader ? 'text-yellow-600' : isTop3 ? 'text-green-700' : 'text-gray-900'
                        }`}>
                          {index + 1}
                          {isLeader && <span className="text-lg">👑</span>}
                          {index === 1 && <span className="text-lg">🥈</span>}
                          {index === 2 && <span className="text-lg">🥉</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{tipper.userName}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-bold text-gray-900 bg-blue-50">
                        {tipper.yearCorrectTips}
                      </td>
                      {selectedRound > 0 && (
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-700 bg-blue-50">
                          {tipper.roundCorrectTips}
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-700 bg-orange-50">
                        {tipper.yearTotalDCCount}
                      </td>
                      {selectedRound > 0 && (
                        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-700 bg-orange-50">
                          {tipper.roundTotalDCCount}
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-green-600 font-medium bg-orange-50">
                        {tipper.yearCorrectDCCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-red-600 font-medium bg-orange-50">
                        {tipper.yearWrongDCCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center bg-orange-50">
                        <span className={`text-sm font-medium ${
                          tipper.yearNetDCScore > 0 ? 'text-green-600' : 
                          tipper.yearNetDCScore < 0 ? 'text-red-600' : 'text-gray-600'
                        }`}>
                          {tipper.yearNetDCScore > 0 ? '+' : ''}{tipper.yearNetDCScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Mobile Ladder Cards */}
      <div className="block md:hidden space-y-3">
        {ladderData.map((tipper, index) => {
          const isLeader = index === 0;
          const isTop3 = index < 3;
          
          return (
            <div 
              key={tipper.userId}
              className={`rounded-lg p-4 shadow ${
                isLeader ? 'bg-yellow-50 border-yellow-200' : 
                isTop3 ? 'bg-green-50 border-green-200' : 'bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                    isLeader ? 'bg-yellow-500 text-white' : 
                    isTop3 ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {index + 1}
                    {isLeader && <span className="ml-1">👑</span>}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{tipper.userName}</div>
                    <div className="text-sm text-gray-500">
                      Season: {tipper.yearCorrectTips} tips{selectedRound > 0 ? ` • Round: ${tipper.roundCorrectTips}` : ''}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">{tipper.yearCorrectTips}</div>
                  <div className="text-sm text-gray-500">
                    {tipper.yearTotalDCCount} DCs
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-center text-sm mb-3">
                <div className="bg-blue-50 p-3 rounded">
                  <div className="text-blue-700 font-medium">Season Tips</div>
                  <div className="font-bold text-lg text-blue-900">{tipper.yearCorrectTips}</div>
                </div>
                {selectedRound > 0 && (
                  <div className="bg-blue-50 p-3 rounded">
                    <div className="text-blue-700 font-medium">Round {selectedRound} Tips</div>
                    <div className="font-bold text-lg text-blue-900">{tipper.roundCorrectTips}</div>
                  </div>
                )}
                {selectedRound === 0 && (
                  <div className="bg-orange-50 p-3 rounded">
                    <div className="text-orange-700 font-medium">Season DCs</div>
                    <div className="font-bold text-lg text-orange-900">{tipper.yearTotalDCCount}</div>
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-center text-sm mb-3">
                <div className="bg-orange-50 p-3 rounded">
                  <div className="text-orange-700 font-medium">Season DCs</div>
                  <div className="font-medium text-orange-900">{tipper.yearTotalDCCount}</div>
                </div>
                {selectedRound > 0 && (
                  <div className="bg-orange-50 p-3 rounded">
                    <div className="text-orange-700 font-medium">Round DCs</div>
                    <div className="font-medium text-orange-900">{tipper.roundTotalDCCount}</div>
                  </div>
                )}
              </div>
              
              <div className="bg-orange-50 p-3 rounded">
                <div className="text-orange-700 font-medium text-center mb-2">Dead Cert Performance</div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <div className="text-orange-600">Season Correct</div>
                    <div className="font-medium text-green-600">{tipper.yearCorrectDCCount}</div>
                  </div>
                  <div>
                    <div className="text-orange-600">Season Wrong</div>
                    <div className="font-medium text-red-600">{tipper.yearWrongDCCount}</div>
                  </div>
                  <div>
                    <div className="text-orange-600">Season Net</div>
                    <div className={`font-medium ${
                      tipper.yearNetDCScore > 0 ? 'text-green-600' : 
                      tipper.yearNetDCScore < 0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {tipper.yearNetDCScore > 0 ? '+' : ''}{tipper.yearNetDCScore}
                    </div>
                  </div>
                </div>
              </div>
              
              {selectedRound > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="text-sm text-gray-600 text-center mb-2">
                    Round {selectedRound} Performance
                  </div>
                  <div className="grid grid-cols-5 gap-1 text-center text-xs">
                    <div>
                      <div className="text-gray-500">Tips</div>
                      <div className="font-medium">{tipper.roundCorrectTips}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">DCs</div>
                      <div className="font-medium">{tipper.roundTotalDCCount}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">✓</div>
                      <div className="font-medium text-green-600">{tipper.roundCorrectDCCount}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">✗</div>
                      <div className="font-medium text-red-600">{tipper.roundWrongDCCount}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Net</div>
                      <div className={`font-medium ${
                        tipper.roundNetDCScore > 0 ? 'text-green-600' : 
                        tipper.roundNetDCScore < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {tipper.roundNetDCScore > 0 ? '+' : ''}{tipper.roundNetDCScore}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Scoring Rules Info */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-blue-800 font-semibold mb-2">Tipping Scoring Rules</h3>
        <ul className="list-disc pl-5 text-blue-700 text-sm space-y-1">
          <li><strong>Correct Tips:</strong> 1 point per correct tip</li>
          <li><strong>Dead Cert Correct:</strong> +6 points (instead of +1)</li>
          <li><strong>Dead Cert Incorrect:</strong> -12 points (instead of 0)</li>
          <li><strong>Net DC Score:</strong> Total points gained/lost from Dead Certs</li>
          <li><strong>Finals:</strong> Tipping continues through all rounds including finals (Rounds 22-24)</li>
          <li>The ladder is sorted by Correct Tips, with Net DC Score as tiebreaker</li>
        </ul>
      </div>
    </div>
  );
}
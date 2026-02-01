// src/app/pages/round-by-round/page.js

'use client';

import React, { useState, useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { USER_NAMES } from '@/app/lib/constants';

export default function RoundByRoundPage() {
  const { selectedYear } = useAppContext();
  const [roundData, setRoundData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);

  useEffect(() => {
    const fetchAllRoundData = async () => {
      try {
        setLoading(true);
        const allData = {};
        
        // Load data for rounds 1-21 (regular season)
        const totalRounds = 21;
        
        for (let round = 1; round <= totalRounds; round++) {
          setLoadingProgress((round / totalRounds) * 100);
          
          try {
            console.log(`Fetching round ${round} data...`);
            
            const res = await fetch(`/api/consolidated-round-results?round=${round}&year=${selectedYear}`);
            if (!res.ok) {
              console.warn(`Could not fetch data for round ${round}: ${res.status}`);
              continue;
            }
            
            const data = await res.json();
            
            if (data.results) {
              // Process each user's data for this round
              Object.entries(data.results).forEach(([userId, userResult]) => {
                if (!allData[userId]) {
                  allData[userId] = { 
                    rounds: {}, 
                    seasonTotals: {
                      playerScore: 0,
                      deadCertScore: 0,
                      totalScore: 0,
                      wins: 0,
                      losses: 0,
                      draws: 0,
                      pointsFor: 0,
                      pointsAgainst: 0
                    }
                  };
                }
                
                // Store round data
                allData[userId].rounds[round] = {
                  playerScore: userResult.playerScore || 0,
                  deadCertScore: userResult.deadCertScore || 0,
                  totalScore: userResult.totalScore || 0,
                  matchResult: userResult.matchResult,
                  opponent: userResult.opponent,
                  opponentScore: userResult.opponentScore || 0,
                  pointsFor: userResult.pointsFor || userResult.totalScore || 0,
                  pointsAgainst: userResult.pointsAgainst || userResult.opponentScore || 0,
                  isHome: userResult.isHome,
                  hasStar: userResult.hasStar,
                  hasCrab: userResult.hasCrab,
                  substitutionsUsed: userResult.substitutionsUsed || []
                };
                
                // Update season totals
                allData[userId].seasonTotals.playerScore += userResult.playerScore || 0;
                allData[userId].seasonTotals.deadCertScore += userResult.deadCertScore || 0;
                allData[userId].seasonTotals.totalScore += userResult.totalScore || 0;
                allData[userId].seasonTotals.pointsFor += userResult.pointsFor || userResult.totalScore || 0;
                allData[userId].seasonTotals.pointsAgainst += userResult.pointsAgainst || userResult.opponentScore || 0;
                
                // Count wins/losses/draws
                if (userResult.matchResult === 'W') {
                  allData[userId].seasonTotals.wins++;
                } else if (userResult.matchResult === 'L') {
                  allData[userId].seasonTotals.losses++;
                } else if (userResult.matchResult === 'D') {
                  allData[userId].seasonTotals.draws++;
                }
              });
            }
            
          } catch (roundError) {
            console.error(`Error fetching round ${round}:`, roundError);
          }
        }

        // Calculate percentages for each user
        Object.keys(allData).forEach(userId => {
          const totals = allData[userId].seasonTotals;
          totals.percentage = totals.pointsAgainst === 0 
            ? (totals.pointsFor > 0 ? totals.pointsFor * 100 : 0)
            : ((totals.pointsFor / totals.pointsAgainst) * 100);
          totals.played = totals.wins + totals.losses + totals.draws;
        });

        setRoundData(allData);
        console.log("Round-by-Round data fetched:", allData);
      } catch (err) {
        console.error('Error fetching round data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
        setLoadingProgress(100);
      }
    };

    fetchAllRoundData();
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center mb-4">
          <div className="text-lg">Loading round data...</div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
            style={{ width: `${loadingProgress}%` }}
          ></div>
        </div>
        <div className="text-center text-sm text-gray-600 mt-2">
          {Math.round(loadingProgress)}% complete
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-red-600">Error: {error}</div>;
  }

  // Sort users by season total score
  const sortedUsers = Object.entries(USER_NAMES).sort(([userIdA], [userIdB]) => {
    const totalA = roundData[userIdA]?.seasonTotals?.totalScore || 0;
    const totalB = roundData[userIdB]?.seasonTotals?.totalScore || 0;
    return totalB - totalA;
  });

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Round-by-Round Results</h1>
      
      {/* Season Summary Table */}
      <div className="mb-8 overflow-x-auto">
        <h2 className="text-xl font-semibold mb-4">Season Summary</h2>
        <table className="min-w-full divide-y divide-gray-200 bg-white shadow rounded-lg">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Player</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Played</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W-L-D</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Player Pts</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Dead Cert</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PF</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PA</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">%</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedUsers.map(([userId, userName], index) => {
              const seasonData = roundData[userId]?.seasonTotals || {};
              return (
                <tr key={userId} className={index === 0 ? 'bg-yellow-50' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className={`text-sm font-bold ${index === 0 ? 'text-yellow-600' : 'text-gray-900'}`}>
                      {index + 1}
                      {index === 0 && ' 👑'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {userName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    {seasonData.played || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    {seasonData.wins || 0}-{seasonData.losses || 0}-{seasonData.draws || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    {seasonData.playerScore || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                    <span className={seasonData.deadCertScore >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {seasonData.deadCertScore >= 0 ? '+' : ''}{seasonData.deadCertScore || 0}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 text-center">
                    {seasonData.totalScore || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    {seasonData.pointsFor || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    {seasonData.pointsAgainst || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    {seasonData.percentage ? seasonData.percentage.toFixed(1) : '0.0'}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Round-by-Round Detail Table */}
      <div className="overflow-x-auto">
        <h2 className="text-xl font-semibold mb-4">Round-by-Round Detail</h2>
        <table className="min-w-full divide-y divide-gray-200 bg-white shadow rounded-lg">
          <thead className="bg-gray-50">
            <tr>
              <th rowSpan="2" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10">Player</th>
              {[...Array(21)].map((_, i) => (
                <th key={i + 1} colSpan="4" className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-l">
                  R{i + 1}
                </th>
              ))}
              <th rowSpan="2" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-l">Season Total</th>
            </tr>
            <tr>
              {[...Array(21)].map((_, i) => (
                <React.Fragment key={i}>
                  <th className="px-1 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PS</th>
                  <th className="px-1 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">DC</th>
                  <th className="px-1 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Tot</th>
                  <th className="px-1 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W/L</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedUsers.map(([userId, userName], userIndex) => (
              <tr key={userId} className={userIndex === 0 ? 'bg-yellow-50' : ''}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 sticky left-0 bg-white z-10">
                  <div className="flex items-center">
                    <span className={userIndex === 0 ? 'text-yellow-600 font-bold' : ''}>
                      {userName}
                      {userIndex === 0 && ' 👑'}
                    </span>
                  </div>
                </td>
                {[...Array(21)].map((_, i) => {
                  const round = i + 1;
                  const roundScores = roundData[userId]?.rounds[round] || {};
                  const hasData = roundScores.totalScore > 0 || roundScores.playerScore > 0;
                  
                  return (
                    <React.Fragment key={round}>
                      <td className={`px-1 py-4 whitespace-nowrap text-xs text-center border-l ${!hasData ? 'text-gray-300' : 'text-gray-700'}`}>
                        {hasData ? roundScores.playerScore || 0 : '-'}
                      </td>
                      <td className={`px-1 py-4 whitespace-nowrap text-xs text-center ${
                        !hasData ? 'text-gray-300' : 
                        (roundScores.deadCertScore || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {hasData ? (
                          <>
                            {(roundScores.deadCertScore || 0) >= 0 ? '+' : ''}
                            {roundScores.deadCertScore || 0}
                          </>
                        ) : '-'}
                      </td>
                      <td className={`px-1 py-4 whitespace-nowrap text-xs font-bold text-center ${
                        !hasData ? 'text-gray-300' : 'text-gray-900'
                      }`}>
                        {hasData ? roundScores.totalScore || 0 : '-'}
                        {roundScores.hasStar && ' ⭐'}
                        {roundScores.hasCrab && ' 🦀'}
                      </td>
                      <td className={`px-1 py-4 whitespace-nowrap text-xs font-medium text-center ${
                        !hasData ? 'text-gray-300' :
                        roundScores.matchResult === 'W' ? 'text-green-600' :
                        roundScores.matchResult === 'L' ? 'text-red-600' : 'text-yellow-600'
                      }`}>
                        {hasData ? roundScores.matchResult || '-' : '-'}
                      </td>
                    </React.Fragment>
                  );
                })}
                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 text-center border-l">
                  {roundData[userId]?.seasonTotals?.totalScore || 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Legend:</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-600">
          <div><strong>PS:</strong> Player Score</div>
          <div><strong>DC:</strong> Dead Cert Score</div>
          <div><strong>Tot:</strong> Total Score</div>
          <div><strong>W/L:</strong> Win/Loss/Draw</div>
          <div><strong>PF:</strong> Points For</div>
          <div><strong>PA:</strong> Points Against</div>
          <div><strong>⭐:</strong> Highest Score (Star)</div>
          <div><strong>🦀:</strong> Lowest Score (Crab)</div>
        </div>
      </div>
    </div>
  );
}
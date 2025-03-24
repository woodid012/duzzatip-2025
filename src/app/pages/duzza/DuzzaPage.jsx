'use client';

import { useState, useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { USER_NAMES, BACKUP_POSITIONS } from '@/app/lib/constants';
import { POSITIONS } from '@/app/lib/scoring_rules';

const DuzzaPage = () => {
  const { currentRound } = useAppContext();
  
  const [displayRound, setDisplayRound] = useState(currentRound || 1);
  const [selectedUserId, setSelectedUserId] = useState('4'); // Default to Le Mallards
  const [squadPlayers, setSquadPlayers] = useState([]);
  const [playerStats, setPlayerStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('desc');
  const [reserveSuggestions, setReserveSuggestions] = useState(null);
  
  // Fetch squad and stats data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Get user's squad
        const squadRes = await fetch(`/api/squads`);
        if (!squadRes.ok) throw new Error('Failed to fetch squad data');
        const squadData = await squadRes.json();
        setSquadPlayers(squadData[selectedUserId]?.players || []);
        
        // Handle round average vs specific round
        if (displayRound === -1) {
          const avgStatsMap = await fetchAverageStats(squadData[selectedUserId]?.players || []);
          setPlayerStats(avgStatsMap);
        } else {
          const statsRes = await fetch(`/api/all-stats?round=${displayRound}`);
          if (!statsRes.ok) throw new Error('Failed to fetch player stats');
          
          // Convert to map for easier lookup
          const statsMap = {};
          (await statsRes.json()).forEach(player => {
            statsMap[player.player_name] = player;
          });
          setPlayerStats(statsMap);
        }
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message);
        setLoading(false);
      }
    };
    
    fetchData();
  }, [displayRound, selectedUserId]);
  
  // Update reserve suggestions when data changes
  useEffect(() => {
    if (squadPlayers.length > 0 && Object.keys(playerStats).length > 0) {
      generateReserveSuggestions();
    }
  }, [squadPlayers, playerStats]);
  
  // Helper function to fetch average stats across rounds
  const fetchAverageStats = async (userSquad) => {
    const availableRounds = Array.from({ length: 21 }, (_, i) => i + 1);
    const avgStatsMap = {};
    const playerRoundCounts = {};
    
    for (const round of availableRounds) {
      try {
        const roundRes = await fetch(`/api/all-stats?round=${round}`);
        if (!roundRes.ok) continue;
        
        const roundData = await roundRes.json();
        if (!roundData?.length) continue;
        
        // Process each player in this round's data
        roundData.forEach(player => {
          const playerName = player.player_name;
          if (!userSquad.some(p => p.name === playerName)) return;
          
          if (!avgStatsMap[playerName]) {
            avgStatsMap[playerName] = { ...player, _roundCount: 1 };
            playerRoundCounts[playerName] = 1;
          } else {
            // Accumulate stats
            ['kicks', 'handballs', 'marks', 'tackles', 'hitouts', 'goals', 
             'behinds', 'disposals'].forEach(stat => {
              avgStatsMap[playerName][stat] = (avgStatsMap[playerName][stat] || 0) + (player[stat] || 0);
            });
            playerRoundCounts[playerName]++;
            avgStatsMap[playerName]._roundCount = playerRoundCounts[playerName];
          }
        });
      } catch (error) {
        console.warn(`Error fetching round ${round}:`, error);
      }
    }
    
    // Calculate averages
    Object.keys(avgStatsMap).forEach(playerName => {
      const count = playerRoundCounts[playerName] || 1;
      ['kicks', 'handballs', 'marks', 'tackles', 'hitouts', 'disposals'].forEach(stat => {
        avgStatsMap[playerName][stat] = Math.round((avgStatsMap[playerName][stat] || 0) / count);
      });
      
      // Goals and behinds get 1 decimal place
      ['goals', 'behinds'].forEach(stat => {
        avgStatsMap[playerName][stat] = Math.round((avgStatsMap[playerName][stat] || 0) / count * 10) / 10;
      });
      
      avgStatsMap[playerName].opp = `Avg of ${count} rounds`;
    });
    
    return avgStatsMap;
  };
  
  // Calculate score for a player in a position
  const calculateScore = (player, position) => {
    if (!player) return { total: 0 };
    
    const positionType = position.toUpperCase().replace(/\s+/g, '_');
    try {
      return POSITIONS[positionType]?.calculation(player) || { total: 0 };
    } catch (error) {
      return { total: 0 };
    }
  };
  
  // Get relative color gradient
  const getColorMap = (scores) => {
    if (!scores?.length) return {};
    
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores.filter(score => score > 0)) || 0;
    const colorMap = {};
    
    scores.forEach(score => {
      if (score === 0) {
        colorMap[score] = 'bg-gray-100 text-gray-500';
        return;
      }
      
      const ratio = maxScore === minScore ? 1 : (score - minScore) / (maxScore - minScore);
      
      if (ratio >= 0.8) colorMap[score] = 'bg-green-100 text-green-800 font-bold';
      else if (ratio >= 0.6) colorMap[score] = 'bg-green-50 text-green-700';
      else if (ratio >= 0.4) colorMap[score] = 'bg-yellow-50 text-yellow-700';
      else if (ratio >= 0.2) colorMap[score] = 'bg-yellow-100 text-yellow-800';
      else colorMap[score] = 'bg-red-50 text-red-700';
    });
    
    return colorMap;
  };
  
  // Handle sorting
  const handleSort = (position) => {
    if (sortField === position) {
      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(position);
      setSortDirection('desc');
    }
  };
  
  // Get sorted squad data
  const getSortedSquadData = () => {
    const squadData = squadPlayers
      .map(player => {
        const stats = playerStats[player.name];
        if (!stats) return null;
        
        const scores = {};
        BACKUP_POSITIONS.forEach(pos => {
          scores[pos] = calculateScore(stats, pos).total;
        });
        
        return { player, stats, scores };
      })
      .filter(Boolean);
    
    if (sortField) {
      squadData.sort((a, b) => {
        const diff = b.scores[sortField] - a.scores[sortField];
        return sortDirection === 'desc' ? diff : -diff;
      });
    }
    
    return squadData;
  };
  
  // Generate reserve suggestions
  const generateReserveSuggestions = () => {
    const bestTeam = calculateBestTeam();
    if (!bestTeam) {
      setReserveSuggestions(null);
      return;
    }
    
    // Get top players who are not in the best team
    const usedPlayers = new Set(
      Object.values(bestTeam.positions)
        .map(pos => pos?.player?.name)
        .filter(Boolean)
    );
    
    // Get scores for all players
    const playerScores = squadPlayers
      .map(player => {
        const stats = playerStats[player.name];
        if (!stats || usedPlayers.has(player.name)) return null;
        
        // Calculate scores for each position
        const scores = {};
        let bestPosition = null;
        let bestScore = -1;
        
        BACKUP_POSITIONS.forEach(pos => {
          const score = calculateScore(stats, pos).total;
          scores[pos] = score;
          
          if (score > bestScore) {
            bestScore = score;
            bestPosition = pos;
          }
        });
        
        return {
          name: player.name,
          team: player.team || stats.team_name,
          scores,
          bestPosition,
          bestScore
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.bestScore - a.bestScore);
    
    // Group positions
    const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
    const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];
    
    // Find best players for each reserve position
    const findBestForPosition = (validPositions) => {
      return playerScores
        .map(player => {
          // Calculate max score for eligible positions
          let bestPos = null;
          let bestScore = -1;
          
          validPositions.forEach(pos => {
            if (player.scores[pos] > bestScore) {
              bestScore = player.scores[pos];
              bestPos = pos;
            }
          });
          
          return {
            ...player,
            reserveBestPosition: bestPos,
            reserveBestScore: bestScore
          };
        })
        .filter(p => p.reserveBestScore > 0)
        .sort((a, b) => b.reserveBestScore - a.reserveBestScore);
    };
    
    // Generate suggestions
    const suggestions = {
      bench: playerScores[0] || null,
      reserveA: findBestForPosition(RESERVE_A_POSITIONS)[0] || null,
      reserveB: findBestForPosition(RESERVE_B_POSITIONS)[0] || null
    };
    
    setReserveSuggestions(suggestions);
  };
  
  // Calculate best team
  const calculateBestTeam = () => {
    const playersWithScores = squadPlayers
      .map(player => {
        const stats = playerStats[player.name];
        if (!stats) return null;
        
        const scores = {};
        BACKUP_POSITIONS.forEach(pos => {
          scores[pos] = calculateScore(stats, pos).total;
        });
        
        return { 
          name: player.name, 
          team: player.team || stats.team_name,
          scores 
        };
      })
      .filter(Boolean);
    
    // Create all possible assignments
    const possibleAssignments = [];
    BACKUP_POSITIONS.forEach(pos => {
      playersWithScores.forEach(player => {
        possibleAssignments.push({
          player,
          position: pos,
          score: player.scores[pos]
        });
      });
    });
    
    // Sort by score and assign greedily
    possibleAssignments.sort((a, b) => b.score - a.score);
    
    const assignedPlayers = new Set();
    const assignedPositions = new Set();
    const bestTeam = {};
    
    possibleAssignments.forEach(assignment => {
      const { player, position, score } = assignment;
      
      if (assignedPlayers.has(player.name) || assignedPositions.has(position))
        return;
      
      bestTeam[position] = { player, score };
      assignedPlayers.add(player.name);
      assignedPositions.add(position);
    });
    
    const totalScore = Object.values(bestTeam).reduce((sum, { score }) => sum + score, 0);
    
    return { positions: bestTeam, totalScore };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-10 w-10 border-4 border-blue-500 rounded-full border-t-transparent"></div>
      </div>
    );
  }

  if (error) {
    return <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>;
  }

  const bestTeam = calculateBestTeam();
  const sortedSquadData = getSortedSquadData();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Duzza Squad Analyzer</h1>
        
        <div className="flex flex-wrap gap-4">
          <div>
            <label htmlFor="user-select" className="block text-sm font-medium text-gray-700 mb-1">Squad:</label>
            <select
              id="user-select"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              {Object.entries(USER_NAMES).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label htmlFor="round-select" className="block text-sm font-medium text-gray-700 mb-1">Round:</label>
            <select
              id="round-select"
              value={displayRound}
              onChange={(e) => setDisplayRound(Number(e.target.value))}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value={-1}>Round (Average)</option>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((round) => (
                <option key={round} value={round}>Round {round}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      
      {/* Suggested Best Team Section */}
      <div className="mb-8">
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <h2 className="text-xl font-semibold text-blue-800">
            Suggested Best Team - {displayRound === -1 ? 'Round Average' : `Round ${displayRound}`}
          </h2>
          <p className="text-blue-700 mt-1">Optimal player assignments based on highest possible scores</p>
        </div>
        
        {!bestTeam ? (
          <div>No data available to calculate best team</div>
        ) : (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {BACKUP_POSITIONS.map(position => {
                const assignment = bestTeam.positions[position];
                
                return (
                  <div key={position} className="border rounded-lg overflow-hidden shadow-sm">
                    <div className="bg-gray-100 px-4 py-2 font-medium">{position}</div>
                    <div className="p-4">
                      {!assignment ? (
                        <div className="text-gray-500">No player available</div>
                      ) : (
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-semibold text-lg">{assignment.player.name}</div>
                            <div className="text-sm text-gray-600">{assignment.player.team}</div>
                          </div>
                          <div className="bg-green-100 text-green-800 font-bold text-lg px-3 py-1 rounded-md">
                            {assignment.score}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg border flex justify-between items-center">
              <div className="text-lg font-medium text-gray-700">Total Team Score:</div>
              <div className="text-2xl font-bold text-green-700">{bestTeam.totalScore}</div>
            </div>
          </div>
        )}
      </div>
      
      {/* Reserve Suggestions Section */}
      {reserveSuggestions && (
        <div className="mb-8">
          <div className="bg-indigo-50 p-4 rounded-lg mb-4">
            <h2 className="text-xl font-semibold text-indigo-800">
              Suggested Reserve Players
            </h2>
            <p className="text-indigo-700 mt-1">Best players for Bench and Reserve positions (not already in starting lineup)</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Bench Suggestion */}
            <div className="border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-indigo-100 px-4 py-2 font-medium">Bench</div>
              <div className="p-4">
                {!reserveSuggestions.bench ? (
                  <div className="text-gray-500">No suitable player found</div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <div className="font-semibold text-lg">{reserveSuggestions.bench.name}</div>
                      </div>
                      <div className="bg-green-100 text-green-800 font-bold px-3 py-1 rounded-md">
                        {reserveSuggestions.bench.bestScore}
                      </div>
                    </div>
                    <div className="bg-indigo-50 p-2 rounded">
                      <div className="font-medium text-indigo-800 mb-1">Recommendation:</div>
                      <div className="text-sm">
                        <span className="font-semibold">Best Position:</span> {reserveSuggestions.bench.bestPosition}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            
            {/* Reserve A Suggestion */}
            <div className="border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-indigo-100 px-4 py-2 font-medium">Reserve A</div>
              <div className="p-4">
                {!reserveSuggestions.reserveA ? (
                  <div className="text-gray-500">No suitable player found</div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <div className="font-semibold text-lg">{reserveSuggestions.reserveA.name}</div>
                      </div>
                      <div className="bg-green-100 text-green-800 font-bold px-3 py-1 rounded-md">
                        {reserveSuggestions.reserveA.reserveBestScore}
                      </div>
                    </div>
                    <div className="bg-indigo-50 p-2 rounded">
                      <div className="font-medium text-indigo-800 mb-1">Recommendation:</div>
                      <div className="text-sm">
                        <span className="font-semibold">Best Position:</span> {reserveSuggestions.reserveA.reserveBestPosition}
                      </div>
                      <div className="text-xs mt-1 text-gray-600">
                        (Full Forward, Tall Forward, Ruck)
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            
            {/* Reserve B Suggestion */}
            <div className="border rounded-lg overflow-hidden shadow-sm">
              <div className="bg-indigo-100 px-4 py-2 font-medium">Reserve B</div>
              <div className="p-4">
                {!reserveSuggestions.reserveB ? (
                  <div className="text-gray-500">No suitable player found</div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <div className="font-semibold text-lg">{reserveSuggestions.reserveB.name}</div>
                      </div>
                      <div className="bg-green-100 text-green-800 font-bold px-3 py-1 rounded-md">
                        {reserveSuggestions.reserveB.reserveBestScore}
                      </div>
                    </div>
                    <div className="bg-indigo-50 p-2 rounded">
                      <div className="font-medium text-indigo-800 mb-1">Recommendation:</div>
                      <div className="text-sm">
                        <span className="font-semibold">Best Position:</span> {reserveSuggestions.reserveB.reserveBestPosition}
                      </div>
                      <div className="text-xs mt-1 text-gray-600">
                        (Offensive, Midfielder, Tackler)
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Squad Table */}
      <div className="mb-6 bg-blue-50 p-4 rounded-lg">
        <h2 className="text-xl font-semibold text-blue-800">
          {USER_NAMES[selectedUserId]}'s Squad - {displayRound === -1 ? 'Round Average' : `Round ${displayRound}`}
        </h2>
        <p className="text-blue-700 mt-1">
          Click on a position heading to sort players by score
          {sortField && (
            <span className="ml-2 text-blue-900 font-medium">
              (Sorted by {sortField}: {sortDirection === 'desc' ? '▼' : '▲'})
            </span>
          )}
        </p>
      </div>
      
      <div className="mb-8 overflow-x-auto">
        <table className="min-w-full bg-white border border-gray-200 divide-y divide-gray-200 rounded-lg shadow">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Player
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Team
              </th>
              {BACKUP_POSITIONS.map(position => (
                <th 
                  key={position} 
                  className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort(position)}
                >
                  {position}
                  {sortField === position && (
                    <span className="ml-1">
                      {sortDirection === 'desc' ? '▼' : '▲'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedSquadData.map((data, index) => {
              const { player, stats, scores } = data;
              
              // Get color map for this row's scores
              const colorMap = getColorMap(Object.values(scores));
              
              return (
                <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 text-sm font-medium text-gray-900">{player.name}</td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {stats.team_name}
                    {stats.opp && (
                      <span className="text-xs text-gray-400 ml-1">
                        vs {stats.opp}
                      </span>
                    )}
                  </td>
                  
                  {BACKUP_POSITIONS.map(position => (
                    <td key={position} className="px-4 py-2 text-center">
                      <div className={`text-sm font-medium rounded-md py-1 ${colorMap[scores[position]]}`}>
                        {scores[position]}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DuzzaPage;
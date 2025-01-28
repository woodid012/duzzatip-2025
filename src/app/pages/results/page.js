'use client'

import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { GiCrab } from 'react-icons/gi';
import { CURRENT_YEAR, USER_NAMES, POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';
import { POSITIONS } from '@/app/lib/scoring_rules';

export default function TeamSelection() {
  const [round, setRound] = useState(0);
  const [teams, setTeams] = useState({});
  const [playerStats, setPlayerStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const calculateScore = (position, stats, backupPosition = null) => {
    if (!stats) return { total: 0, breakdown: [] };
    
    // If it's a bench position, use the backup position for scoring
    if ((position === 'BENCH' || position.startsWith('RESERVE')) && backupPosition) {
      const backupPositionType = backupPosition.toUpperCase().replace(/\s+/g, '_');
      return POSITIONS[backupPositionType]?.calculation(stats) || { total: 0, breakdown: [] };
    }

    // For regular positions, use the position's scoring rules
    const formattedPosition = position.replace(/\s+/g, '_');
    return POSITIONS[formattedPosition]?.calculation(stats) || { total: 0, breakdown: [] };
  };

  // Function to check if bench player should replace main team player
  const getBestPlayerForPosition = (mainPlayer, benchPlayers, position) => {
    if (!mainPlayer || !benchPlayers) return mainPlayer;

    const mainScore = mainPlayer.scoring?.total || 0;
    let bestPlayer = mainPlayer;
    let bestScore = mainScore;

    benchPlayers.forEach(benchPlayer => {
      if (benchPlayer.backup_position === position) {
        const benchScore = benchPlayer.scoring?.total || 0;
        if (benchScore > bestScore) {
          bestPlayer = benchPlayer;
          bestScore = benchScore;
        }
      }
    });

    return bestPlayer;
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const teamsRes = await fetch(`/api/team-selection?round=${round}`);
        if (!teamsRes.ok) throw new Error('Failed to fetch teams');
        const teamsData = await teamsRes.json();
        setTeams(teamsData);
    
        const allStats = {};
        for (const [userId, team] of Object.entries(teamsData)) {
          // Collect all player names for this team
          const playerNames = Object.values(team)
            .map(data => data.player_name)
            .filter(Boolean); // Remove any undefined/null values
    
          // Make a single API call for all players in the team
          const res = await fetch(`/api/player-stats?round=${round}&players=${encodeURIComponent(playerNames.join(','))}`);
          if (!res.ok) throw new Error('Failed to fetch player stats');
          const statsData = await res.json();
    
          // Process the stats for each player
          const playerStats = {};
          for (const [position, data] of Object.entries(team)) {
            const playerName = data.player_name;
            const stats = statsData[playerName];
            const positionType = position.toUpperCase().replace(/\s+/g, '_');
            
            const scoring = calculateScore(positionType, stats, data.backup_position);
            playerStats[playerName] = {
              ...stats,
              scoring,
              backup_position: data.backup_position,
              original_position: position
            };
          }
          allStats[userId] = playerStats;
        }
        setPlayerStats(allStats);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [round]);

  if (loading) return <div className="p-4">Loading stats...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  // Calculate all final scores to determine highest and lowest
  const allFinalScores = Object.entries(teams).map(([userId, team]) => {
    const userTeam = teams[userId] || {};
    const benchPlayers = Object.entries(userTeam)
      .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
      .map(([_, data]) => playerStats[userId]?.[data.player_name])
      .filter(Boolean);

    const mainTeamPositions = POSITION_TYPES.filter(pos => 
      !pos.includes('Bench') && !pos.includes('Reserve'));
    
    const totalScore = mainTeamPositions.reduce((total, position) => {
      const playerData = Object.entries(userTeam).find(([pos]) => pos === position)?.[1];
      if (!playerData) return total;
      
      const mainPlayerStats = playerStats[userId]?.[playerData.player_name];
      const bestPlayer = getBestPlayerForPosition(mainPlayerStats, benchPlayers, position);
      
      return total + (bestPlayer?.scoring?.total || 0);
    }, 0);

    return { userId, totalScore: totalScore + 0 }; // Adding deadCertsScore (0)
  });

  const highestScore = Math.max(...allFinalScores.map(s => s.totalScore));
  const lowestScore = Math.min(...allFinalScores.map(s => s.totalScore));

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold">Team Scores</h1>
          <div className="w-full sm:w-auto flex items-center gap-2">
            <label htmlFor="round-select" className="text-sm font-medium">Round:</label>
            <select 
              id="round-select"
              value={round}
              onChange={(e) => setRound(Number(e.target.value))}
              className="p-2 border rounded w-24 text-lg"
            >
              {[...Array(29)].map((_, i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(USER_NAMES).map(([userId, userName]) => {
          const userTeam = teams[userId] || {};
          const benchPlayers = Object.entries(userTeam)
            .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
            .map(([_, data]) => playerStats[userId]?.[data.player_name])
            .filter(Boolean);

          const mainTeamPositions = POSITION_TYPES.filter(pos => 
            !pos.includes('Bench') && !pos.includes('Reserve'));
          
          const totalScore = mainTeamPositions.reduce((total, position) => {
            const playerData = Object.entries(userTeam).find(([pos]) => pos === position)?.[1];
            if (!playerData) return total;
            
            const mainPlayerStats = playerStats[userId]?.[playerData.player_name];
            const bestPlayer = getBestPlayerForPosition(mainPlayerStats, benchPlayers, position);
            
            return total + (bestPlayer?.scoring?.total || 0);
          }, 0);

          const deadCertsScore = 0;
          const finalTotalScore = totalScore + deadCertsScore;

          return (
            <div key={userId} className="bg-white rounded-lg shadow-md p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-bold">{userName}</h2>
                  {finalTotalScore === highestScore && <Star className="text-yellow-500" size={20} />}
                  {finalTotalScore === lowestScore && <GiCrab className="text-red-500" size={20} />}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{finalTotalScore}</span>
                  <button 
                    onClick={() => {
                      const element = document.getElementById(`scores-${userId}`);
                      if (element) {
                        element.classList.toggle('hidden');
                      }
                    }}
                    className="text-gray-500 hover:text-gray-700 sm:hidden"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>

              <div id={`scores-${userId}`} className="space-y-4">
                {/* Main Team */}
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold border-b pb-2">Main Team</h3>
                  <div className="hidden sm:grid grid-cols-12 gap-2 font-semibold text-sm pb-2">
                    <div className="col-span-2">Position</div>
                    <div className="col-span-3">Player</div>
                    <div className="col-span-5">Details</div>
                    <div className="col-span-2 text-right">Score</div>
                  </div>
                  {mainTeamPositions.map((positionType) => {
                    const position = Object.entries(userTeam).find(([pos]) => pos === positionType)?.[0];
                    if (!position) return null;
                    
                    const data = userTeam[position];
                    const mainPlayerStats = playerStats[userId]?.[data.player_name];
                    const bestPlayer = getBestPlayerForPosition(mainPlayerStats, benchPlayers, position);
                    
                    return (
                      <div key={position} className="border rounded p-2 sm:border-0 sm:p-0 sm:grid grid-cols-12 gap-2 text-sm">
                        <div className="font-medium col-span-2 mb-1 sm:mb-0">{position}</div>
                        <div className="col-span-3 mb-1 sm:mb-0">
                          {bestPlayer !== mainPlayerStats ? (
                            <span className="text-green-600">Bench: {bestPlayer.player_name}</span>
                          ) : (
                            data.player_name
                          )}
                        </div>
                        <div className="col-span-5 text-gray-600 text-xs sm:text-sm mb-1 sm:mb-0">
                          {bestPlayer?.scoring?.breakdown.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                        <div className="col-span-2 text-right font-semibold">
                          {bestPlayer?.scoring?.total || 0}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Dead Certs */}
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold border-b pb-2">Dead Certs</h3>
                  <div className="text-right font-semibold">
                    Score: {deadCertsScore}
                  </div>
                </div>

                {/* Bench/Reserves */}
                <div className="space-y-2 bg-gray-50 p-2 sm:p-4 rounded">
                  <h3 className="text-lg font-semibold border-b pb-2">Bench/Reserves</h3>
                  {Object.entries(userTeam)
                    .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
                    .map(([position, data]) => {
                      const benchStats = playerStats[userId]?.[data.player_name];
                      const backupPosition = data.backup_position;
                      
                      const replacedPosition = mainTeamPositions.find(pos => {
                        const posData = userTeam[pos];
                        const posStats = playerStats[userId]?.[posData?.player_name];
                        const bestPlayer = getBestPlayerForPosition(posStats, benchPlayers, pos);
                        return bestPlayer?.player_name === data.player_name;
                      });

                      const isBeingUsed = !!replacedPosition;
                      const originalPlayerData = isBeingUsed ? userTeam[replacedPosition] : null;
                      const displayStats = isBeingUsed ? 
                        playerStats[userId]?.[originalPlayerData?.player_name] : 
                        benchStats;
                      
                      return (
                        <div key={position} className="border rounded p-2 sm:border-0 sm:p-0 sm:grid grid-cols-12 gap-2 text-sm">
                          <div className="font-medium col-span-2 mb-1 sm:mb-0">
                            {position}
                            {backupPosition && (
                              <div className="text-xs text-gray-600">{backupPosition}</div>
                            )}
                          </div>
                          <div className="col-span-3 mb-1 sm:mb-0">
                            {isBeingUsed ? (
                              <span className="text-red-600">{originalPlayerData?.player_name}</span>
                            ) : (
                              data.player_name
                            )}
                          </div>
                          <div className="col-span-5 text-gray-600 text-xs sm:text-sm mb-1 sm:mb-0">
                            {displayStats?.scoring?.breakdown.map((line, i) => (
                              <div key={i}>{line}</div>
                            ))}
                          </div>
                          <div className="col-span-2 text-right font-semibold">
                            {displayStats?.scoring?.total || 0}
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
    </div>
  );
}
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
          const playerStats = {};
          for (const [position, data] of Object.entries(team)) {
            const res = await fetch(`/api/player-stats?round=${round}&player_name=${encodeURIComponent(data.player_name)}`);
            if (res.ok) {
              const stats = await res.json();
              const positionType = position.toUpperCase().replace(/\s+/g, '_');
              
              const scoring = calculateScore(positionType, stats, data.backup_position);
              playerStats[data.player_name] = {
                ...stats,
                scoring,
                backup_position: data.backup_position,
                original_position: position
              };
            }
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
    <div className="p-6 w-full mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">Team Scores - Round {round}</h1>
        <select 
          value={round}
          onChange={(e) => setRound(Number(e.target.value))}
          className="p-2 border rounded"
        >
          {[...Array(29)].map((_, i) => (
            <option key={i} value={i}>Round {i}</option>
          ))}
        </select>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(USER_NAMES).map(([userId, userName]) => {
          const userTeam = teams[userId] || {};
          
          // Get bench players
          const benchPlayers = Object.entries(userTeam)
            .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
            .map(([_, data]) => playerStats[userId]?.[data.player_name])
            .filter(Boolean);

          // Calculate main team score with potential bench replacements
          const mainTeamPositions = POSITION_TYPES.filter(pos => 
            !pos.includes('Bench') && !pos.includes('Reserve'));
          
          const totalScore = mainTeamPositions.reduce((total, position) => {
            const playerData = Object.entries(userTeam).find(([pos]) => pos === position)?.[1];
            if (!playerData) return total;
            
            const mainPlayerStats = playerStats[userId]?.[playerData.player_name];
            const bestPlayer = getBestPlayerForPosition(mainPlayerStats, benchPlayers, position);
            
            return total + (bestPlayer?.scoring?.total || 0);
          }, 0);

          // Add Dead Certs score (currently 0)
          const deadCertsScore = 0;
          const finalTotalScore = totalScore + deadCertsScore;

          return (
            <div key={userId} className="bg-white shadow-sm rounded-lg p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  {userName}
                  {finalTotalScore === highestScore && <Star className="text-yellow-500" size={20} />}
                  {finalTotalScore === lowestScore && <GiCrab className="text-red-500" size={20} />}
                </h2>
                <div className="text-lg font-semibold">Total: {finalTotalScore}</div>
              </div>
              
              {/* Main Team */}
              <div className="space-y-4 mb-6">
                <h3 className="text-lg font-semibold border-b pb-2">Main Team</h3>
                <div className="grid grid-cols-12 gap-2 font-semibold border-b pb-2">
                  <div className="col-span-2">Position</div>
                  <div className="col-span-3">Player</div>
                  <div className="col-span-5">Calculation</div>
                  <div className="col-span-2 text-right">Score</div>
                </div>
                {mainTeamPositions.map((positionType) => {
                  const position = Object.entries(userTeam).find(([pos]) => pos === positionType)?.[0];
                  if (!position) return null;
                  
                  const data = userTeam[position];
                  const mainPlayerStats = playerStats[userId]?.[data.player_name];
                  const bestPlayer = getBestPlayerForPosition(mainPlayerStats, benchPlayers, position);
                  
                  return (
                    <div key={position} className="grid grid-cols-12 gap-2 border-b pb-2">
                      <div className="col-span-2 font-medium">{position}</div>
                      <div className="col-span-3">
                        {bestPlayer !== mainPlayerStats ? (
                          <span className="text-green-600">Bench: {bestPlayer.player_name}</span>
                        ) : (
                          data.player_name
                        )}
                      </div>
                      <div className="col-span-5 text-sm text-gray-600">
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
              <div className="space-y-4 mb-6">
                <h3 className="text-lg font-semibold border-b pb-2">Dead Certs</h3>
                <div className="text-right font-semibold">
                  Score: {deadCertsScore}
                </div>
              </div>

              {/* Bench/Reserves */}
              <div className="space-y-4 bg-gray-50 p-4 rounded">
                <h3 className="text-lg font-semibold border-b pb-2">Bench/Reserves</h3>
                {Object.entries(userTeam)
                  .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
                  .map(([position, data]) => {
                    const benchStats = playerStats[userId]?.[data.player_name];
                    const backupPosition = data.backup_position;
                    
                    // Find if this bench player is being used in the main team
                    const replacedPosition = mainTeamPositions.find(pos => {
                      const posData = userTeam[pos];
                      const posStats = playerStats[userId]?.[posData?.player_name];
                      const bestPlayer = getBestPlayerForPosition(posStats, benchPlayers, pos);
                      return bestPlayer?.player_name === data.player_name;
                    });

                    // If bench player is being used, get the original player's stats
                    const isBeingUsed = !!replacedPosition;
                    const originalPlayerData = isBeingUsed ? userTeam[replacedPosition] : null;
                    const displayStats = isBeingUsed ? 
                      playerStats[userId]?.[originalPlayerData?.player_name] : 
                      benchStats;
                    
                    return (
                      <div key={position} className="grid grid-cols-12 gap-2 border-b pb-2">
                        <div className="col-span-2 font-medium">
                          {position}
                          {backupPosition && ` (${backupPosition})`}
                        </div>
                        <div className="col-span-3">
                          {isBeingUsed ? (
                            <span className="text-red-600">{originalPlayerData?.player_name}</span>
                          ) : (
                            data.player_name
                          )}
                        </div>
                        <div className="col-span-5 text-sm text-gray-600">
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
          );
        })}
      </div>
    </div>
  );
}
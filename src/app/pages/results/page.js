'use client'

import { useState, useEffect } from 'react';
import ResultCard from './ResultCard';
import { POSITIONS } from '@/app/lib/scoring_rules';
import { POSITION_TYPES, TEAM_NAMES, CURRENT_YEAR } from '@/app/lib/constants';

export default function Results() {
  // State declarations remain the same
  const [roundData, setRoundData] = useState({
    teamSelections: {},
    playerStats: {},
  });
  const [currentRound, setCurrentRound] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const users = [1, 2, 3, 4, 5, 6, 7, 8];

  // Rest of the component remains the same until the round selector
  useEffect(() => {
    const fetchRoundData = async () => {
      try {
        console.log('Fetching round data for round:', currentRound);
        setLoading(true);
        
        const selectionsRes = await fetch(`/api/team-selection?year=${CURRENT_YEAR}&round=${currentRound}`);
        
        if (!selectionsRes.ok) {
          throw new Error(`Failed to fetch team selections: ${selectionsRes.status}`);
        }
        
        const teamSelections = await selectionsRes.json();
        
        const playerIds = new Set();
        Object.values(teamSelections).forEach(userSelections => {
          Object.values(userSelections).forEach(selection => {
            if (selection.player_id) {
              playerIds.add(selection.player_id);
            }
          });
        });
        
        const playerStats = {};
        await Promise.all(Array.from(playerIds).map(async (playerId) => {
          const statsRes = await fetch(
            `/api/player-stats?year=${CURRENT_YEAR}&round=${currentRound}&player_id=${playerId}`
          );
          if (statsRes.ok) {
            const data = await statsRes.json();
            if (data.stats) {
              playerStats[playerId] = data.stats;
            }
          }
        }));

        setRoundData({
          teamSelections,
          playerStats
        });
        setLoading(false);
      } catch (err) {
        console.error('Error fetching round data:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchRoundData();
  }, [currentRound]);

  const calculateTeamPoints = () => {
    const results = {};

    users.forEach(user => {
      const userSelections = roundData.teamSelections[user] || {};
      const userResults = {
        total: 0,
        positions: {}
      };

      const reserveA = userSelections['Reserve A'];
      const reserveB = userSelections['Reserve B'];
      let reserveAUsed = null;
      let reserveBUsed = null;

      const positionsNeedingSubstitution = [];
      
      Object.entries(userSelections).forEach(([position, selection]) => {
        if (['Reserve A', 'Reserve B', 'Bench'].includes(position)) return;

        const playerStats = roundData.playerStats[selection.player_id] || {};
        const positionRule = POSITIONS[position.toUpperCase()];
        
        if (positionRule) {
          const result = positionRule.calculation(playerStats);
          
          if (!playerStats.player_id || result.total === 0) {
            positionsNeedingSubstitution.push(position);
          } else {
            userResults.positions[position] = {
              player_id: selection.player_id,
              player_name: selection.player_name,
              points: result.total,
              breakdown: result.breakdown
            };
          }
        }
      });

      positionsNeedingSubstitution.forEach((position) => {
        const positionRule = POSITIONS[position.toUpperCase()];
        let substituteMade = false;

        if (!reserveAUsed && reserveA) {
          const reserveStats = roundData.playerStats[reserveA.player_id] || {};
          const reserveResult = positionRule.calculation(reserveStats);
          
          if (reserveResult.total > 0) {
            userResults.positions[position] = {
              player_id: reserveA.player_id,
              player_name: reserveA.player_name,
              points: reserveResult.total,
              breakdown: reserveResult.breakdown,
              substituted: true,
              substitutionSource: 'Reserve A'
            };
            reserveAUsed = position;
            substituteMade = true;
          }
        }
        
        if (!substituteMade && !reserveBUsed && reserveB) {
          const reserveStats = roundData.playerStats[reserveB.player_id] || {};
          const reserveResult = positionRule.calculation(reserveStats);
          
          if (reserveResult.total > 0) {
            userResults.positions[position] = {
              player_id: reserveB.player_id,
              player_name: reserveB.player_name,
              points: reserveResult.total,
              breakdown: reserveResult.breakdown,
              substituted: true,
              substitutionSource: 'Reserve B'
            };
            reserveBUsed = position;
            substituteMade = true;
          }
        }

        if (!substituteMade) {
          const originalSelection = userSelections[position];
          userResults.positions[position] = {
            player_id: originalSelection.player_id,
            player_name: originalSelection.player_name,
            points: 0,
            breakdown: ['No valid player or substitute available']
          };
        }
      });

      const benchSelection = userSelections.Bench;
      if (benchSelection?.backup_position) {
        const benchStats = roundData.playerStats[benchSelection.player_id] || {};
        const backupRule = POSITIONS[benchSelection.backup_position.toUpperCase()];
        
        if (backupRule) {
          const benchResult = backupRule.calculation(benchStats);
          const originalPosition = userResults.positions[benchSelection.backup_position];

          if (benchResult.total > (originalPosition?.points || 0)) {
            userResults.positions[benchSelection.backup_position] = {
              player_id: benchSelection.player_id,
              player_name: benchSelection.player_name,
              points: benchResult.total,
              breakdown: benchResult.breakdown,
              substituted: true,
              substitutionSource: 'Bench'
            };
          }
        }
      }

      userResults.total = Object.values(userResults.positions)
        .reduce((sum, pos) => sum + pos.points, 0);

      results[user] = userResults;
    });

    return results;
  };

  if (loading) return <div className="p-4">Loading results...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  const roundResults = calculateTeamPoints();

  return (
    <div className="p-6 w-full mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Round Results {CURRENT_YEAR}</h1>
        </div>
        
        <div className="flex items-center space-x-4">
          <div>
            <label htmlFor="round-select" className="mr-2">Round:</label>
            <select 
              id="round-select"
              value={currentRound}
              onChange={(e) => setCurrentRound(Number(e.target.value))}
              className="p-2 border rounded"
            >
              {[...Array(28)].map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  Round {i + 1}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mb-6 p-4 bg-white rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Round {currentRound} Standings</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {users.map(user => {
            const position = users.map(u => ({
              user: u,
              total: roundResults[u]?.total || 0
            }))
            .sort((a, b) => b.total - a.total)
            .findIndex(item => item.user === user) + 1;

            return (
              <div 
                key={user} 
                className={`p-3 rounded border ${
                  position === 1 ? 'border-yellow-400 bg-yellow-50' : ''
                }`}
              >
                <div className="text-sm text-gray-600">#{position}</div>
                <div className="font-bold">{TEAM_NAMES[user]}</div>
                <div className="text-lg">{roundResults[user]?.total || 0} points</div>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {users.map(user => (
          <ResultCard
            key={user}
            user={user}
            teamSelection={roundData.teamSelections[user] || {}}
            results={roundResults[user]?.positions || {}}
          />
        ))}
      </div>
    </div>
  );
}
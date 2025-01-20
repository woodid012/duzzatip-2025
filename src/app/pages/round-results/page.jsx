'use client'

import { useState, useEffect } from 'react';
import ResultCard from '../results/ResultCard';
import { FIXTURES, getFixturesForRound } from '@/app/lib/fixture_constants';
import { TEAM_NAMES, CURRENT_YEAR } from '@/app/lib/constants';
import { POSITIONS } from '@/app/lib/scoring_rules';

export default function RoundResults() {
  const [roundData, setRoundData] = useState({
    teamSelections: {},
    playerStats: {},
  });
  const [currentRound, setCurrentRound] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchRoundData = async () => {
      try {
        console.log('Fetching round data for round:', currentRound);
        setLoading(true);
        
        // First get team selections
        const selectionsRes = await fetch(`/api/team-selection?year=${CURRENT_YEAR}&round=${currentRound}`);
        
        if (!selectionsRes.ok) {
          throw new Error(`Failed to fetch team selections: ${selectionsRes.status}`);
        }
        
        const teamSelections = await selectionsRes.json();
        
        // Get all selected player IDs
        const playerIds = new Set();
        Object.values(teamSelections).forEach(userSelections => {
          Object.values(userSelections).forEach(selection => {
            if (selection.player_id) {
              playerIds.add(selection.player_id);
            }
          });
        });
        
        // Fetch stats for all selected players
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

  // Calculate team points based on selections and player stats
  const calculateTeamPoints = () => {
    const results = {};

    Object.keys(roundData.teamSelections).forEach(user => {
      const userSelections = roundData.teamSelections[user] || {};
      const userResults = {
        total: 0,
        positions: {}
      };

      // Get reserve players for filling in missing/zero scores
      const reserveA = userSelections['Reserve A'];
      const reserveB = userSelections['Reserve B'];
      let reserveAUsed = null;
      let reserveBUsed = null;

      // First pass: Calculate initial points for all positions
      const positionsNeedingSubstitution = [];
      
      Object.entries(userSelections).forEach(([position, selection]) => {
        // Skip reserve positions and bench in first pass
        if (['Reserve A', 'Reserve B', 'Bench'].includes(position)) return;

        const playerStats = roundData.playerStats[selection.player_id] || {};
        const positionRule = POSITIONS[position.toUpperCase()];
        
        if (positionRule) {
          const result = positionRule.calculation(playerStats);
          
          // If player has no stats or zero points, mark for substitution
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

      // Second pass: Handle substitutions for missing/zero scores
      positionsNeedingSubstitution.forEach((position) => {
        const positionRule = POSITIONS[position.toUpperCase()];
        let substituteMade = false;

        // Try Reserve A first if not already used
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
        
        // If Reserve A wasn't used or didn't have points, try Reserve B
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

        // If no substitution was made, set to zero
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

      // Third pass: Check if bench player can improve any position
      const benchSelection = userSelections.Bench;
      if (benchSelection?.backup_position) {
        const benchStats = roundData.playerStats[benchSelection.player_id] || {};
        const backupRule = POSITIONS[benchSelection.backup_position.toUpperCase()];
        
        if (backupRule) {
          const benchResult = backupRule.calculation(benchStats);
          const originalPosition = userResults.positions[benchSelection.backup_position];

          if (benchResult.total > (originalPosition?.points || 0)) {
            // Substitute bench player
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

      // Calculate final total
      userResults.total = Object.values(userResults.positions)
        .reduce((sum, pos) => sum + pos.points, 0);

      results[user] = userResults;
    });

    return results;
  };

  if (loading) return <div className="p-4">Loading results...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  const roundResults = calculateTeamPoints();
  const fixtures = getFixturesForRound(currentRound);

  return (
    <div className="p-6 w-full mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Round {currentRound} Results {CURRENT_YEAR}</h1>
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
              {Object.keys(FIXTURES).map((round) => (
                <option key={round} value={round}>
                  Round {round}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Display matches in pairs */}
      <div className="space-y-8">
        {fixtures.map((fixture, index) => (
          <div key={index} className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-bold mb-4">Match {index + 1}</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <ResultCard
                user={fixture.home}
                teamSelection={roundData.teamSelections[fixture.home] || {}}
                results={roundResults[fixture.home]?.positions || {}}
              />
              <ResultCard
                user={fixture.away}
                teamSelection={roundData.teamSelections[fixture.away] || {}}
                results={roundResults[fixture.away]?.positions || {}}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
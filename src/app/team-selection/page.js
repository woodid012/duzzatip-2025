'use client';

import { useState, useEffect } from 'react';
import { CURRENT_YEAR } from '@/app/lib/config';

const MAIN_POSITIONS = ['FF', 'MF', 'OFF', 'MID', 'TK', 'RUCK'];
const POSITIONS = [...MAIN_POSITIONS, 'BENCH', 'RES_A', 'RES_B'];

const TEAMS = Array.from({ length: 8 }, (_, i) => i + 1);
const ROUNDS = Array.from({ length: 24 }, (_, i) => i + 1);

export default function TeamSelection() {
  const [selectedRound, setSelectedRound] = useState(1);
  const [squads, setSquads] = useState({});
  const [players, setPlayers] = useState({});
  const [selections, setSelections] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // Fetch squads and team selection data
  const fetchData = async (round) => {
    try {
      setLoading(true);
      const [squadsRes, selectionsRes, playersRes] = await Promise.all([
        fetch('/api/squads'),
        fetch(`/api/team-selection?round=${round}`),
        fetch('/api/players')
      ]);
  
      if (!squadsRes.ok || !selectionsRes.ok || !playersRes.ok) {
        throw new Error('Failed to fetch data');
      }
  
      const squadsData = await squadsRes.json();
      const selectionsData = await selectionsRes.json();
      const playersData = await playersRes.json();
  
      const selectionsMap = {};
      
      selectionsData.forEach(selection => {
        if (!selectionsMap[selection.team]) selectionsMap[selection.team] = {};
        selectionsMap[selection.team][selection.position] = {
          player_id: selection.player_id,
          player_name: selection.player_name,
          timestamp: selection.timestamp
        };
      });
  
      // Ensure selections include players from squads
      Object.entries(squadsData).forEach(([team, teamData]) => {
        if (!selectionsMap[team]) selectionsMap[team] = {};
        teamData.players.forEach(player => {
          if (!Object.values(selectionsMap[team]).some(s => s?.player_id === player.player_id)) {
            selectionsMap[team][player.position || player.player_id] = {
              player_id: player.player_id,
              player_name: player.player_name,
              timestamp: null
            };
          }
        });
      });
  
      setSquads(squadsData);
      setSelections(selectionsMap);
      setPlayers(playersData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isEditing) fetchData(selectedRound);
  }, [selectedRound, isEditing]);

  // Handle player selection
  const handlePlayerChange = (team, position, playerId) => {
    if (!isEditing) return;
  
    // Find selected player from players data
    const selectedPlayerTeam = Object.values(players).find(teamPlayers => 
      teamPlayers.some(p => p.id === parseInt(playerId))
    );
    const selectedPlayer = selectedPlayerTeam?.find(p => p.id === parseInt(playerId));
  
    setSelections(prevSelections => ({
      ...prevSelections,
      [team]: {
        ...(prevSelections[team] || {}),
        [position]: selectedPlayer
          ? { 
              player_id: selectedPlayer.id, 
              player_name: selectedPlayer.name, 
              timestamp: new Date().toISOString() 
            }
          : { 
              player_id: parseInt(playerId), 
              player_name: "Unknown Player", 
              timestamp: new Date().toISOString() 
            }
      }
    }));
  };

  // Save selections
  const handleSave = async () => {
    try {
      // Send each selection individually
      const savePromises = Object.entries(selections).flatMap(([team, teamSelections]) => 
        Object.entries(teamSelections).map(([position, data]) => {
          const selectionToSave = {
            round: selectedRound,
            team: parseInt(team),
            position,
            player_id: data.player_id,
            player_name: data.player_name,
            timestamp: data.timestamp || new Date().toISOString()
          };

          return fetch('/api/team-selection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(selectionToSave)
          });
        })
      );

      // Wait for all save operations to complete
      const responses = await Promise.all(savePromises);

      // Check for any errors in the responses
      const failedResponses = responses.filter(response => !response.ok);
      if (failedResponses.length > 0) {
        const errorTexts = await Promise.all(
          failedResponses.map(response => response.text())
        );
        throw new Error(`Failed to save some selections: ${errorTexts.join(', ')}`);
      }

      // Reload data to confirm save
      await fetchData(selectedRound);
      
      // Exit edit mode
      setIsEditing(false);
    } catch (err) {
      console.error('Save error:', err);
      setError(`Failed to save changes: ${err.message}`);
    }
  };

  // Cancel editing and revert changes
  const handleCancel = () => {
    setIsEditing(false);
    // Reload original data to discard any unsaved changes
    fetchData(selectedRound);
  };

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  return (
    <div className="p-6 w-full mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Team Selection {CURRENT_YEAR}</h1>
        <div className="flex items-center gap-4">
          <label className="font-medium">Round:</label>
          <select
            value={selectedRound}
            onChange={(e) => setSelectedRound(Number(e.target.value))}
            className="p-2 border rounded"
            disabled={isEditing}
          >
            {ROUNDS.map(round => <option key={round} value={round}>Round {round}</option>)}
          </select>
          {isEditing ? (
            <>
              <button 
                onClick={handleSave} 
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Save Changes
              </button>
              <button 
                onClick={handleCancel}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Cancel
              </button>
            </>
          ) : (
            <button 
              onClick={() => setIsEditing(true)} 
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Edit Teams
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {TEAMS.map(team => (
          <div key={team} className="bg-white rounded-lg shadow-md p-4">
            <h2 className="text-xl font-bold mb-4">Team {team}</h2>
            <div className="space-y-3">
              {POSITIONS.map(position => (
                <div key={position} className="flex items-center gap-2">
                  <span className="text-sm font-medium w-20">{position}:</span>
                  <select
                    value={selections[team]?.[position]?.player_id || ''}
                    onChange={(e) => handlePlayerChange(team, position, e.target.value)}
                    disabled={!isEditing}
                    className="flex-1 p-2 text-sm border rounded"
                  >
                    <option value="">Select Player</option>
                    {Object.entries(players).map(([clubId, clubPlayers]) => (
                      <optgroup key={clubId} label={clubPlayers[0]?.teamName || 'Unknown Team'}>
                        {clubPlayers.map(player => (
                          <option key={`${clubId}-${player.id}`} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
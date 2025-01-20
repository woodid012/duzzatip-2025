'use client'

import { useState, useEffect } from 'react';
import { POSITION_TYPES, TEAM_NAMES, CURRENT_YEAR } from '@/app/lib/constants';

export default function Squads() {
  const [squads, setSquads] = useState({});
  const [players, setPlayers] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [squadsRes, playersRes] = await Promise.all([
          fetch('/api/squads'),
          fetch('/api/players')
        ]);

        if (!squadsRes.ok || !playersRes.ok) throw new Error('Failed to fetch');
        
        const squadsData = await squadsRes.json();
        const playersData = await playersRes.json();
        
        // Create a flattened map of all players for quick lookup
        const allPlayers = Object.values(playersData).flat();
        const playerMap = {};
        allPlayers.forEach(player => {
          playerMap[player.id] = player;
        });
        
        // Update squad players with their current team names
        const updatedSquads = {};
        for (const [teamId, team] of Object.entries(squadsData)) {
          updatedSquads[teamId] = {
            ...team,
            players: team.players.map(player => {
              const currentPlayer = playerMap[player.id];
              return {
                ...player,
                currentTeam: currentPlayer ? currentPlayer.teamName : '-'
              };
            })
          };
        }
        
        setSquads(updatedSquads);
        setPlayers(playersData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handlePlayerChange = (teamId, playerId, newPlayerId) => {
    setSquads(prev => {
      const newSquads = {...prev};
      const team = newSquads[teamId];
      const playerIndex = team.players.findIndex(p => p.id === playerId);
      
      if (playerIndex !== -1) {
        const allPlayers = Object.values(players).flat();
        const newPlayerData = allPlayers.find(p => p.id === Number(newPlayerId));
        if (newPlayerData) {
          team.players[playerIndex] = {
            ...team.players[playerIndex],
            id: Number(newPlayerId),
            name: newPlayerData.name,
            currentTeam: newPlayerData.teamName
          };
        }
      }
      
      return newSquads;
    });
  };

  const handleSave = async () => {
    try {
      const response = await fetch('/api/squads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(squads)
      });

      if (!response.ok) throw new Error('Failed to save');
      setIsEditing(false);
    } catch (err) {
      setError('Failed to save changes');
    }
  };

  if (loading) return <div className="p-4">Loading squads...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  return (
    <div className="p-6 w-full mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">DuzzaTip Squads {CURRENT_YEAR}</h1>
        <div className="space-x-2">
          {isEditing ? (
            <>
              <button 
                onClick={handleSave}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Save Changes
              </button>
              <button 
                onClick={() => setIsEditing(false)}
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
              Edit Squads
            </button>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Object.entries(squads).map(([teamId, team]) => (
          <div key={teamId} className="bg-white rounded-lg shadow-md p-4 grid grid-rows-[auto_1fr]">
            <h2 className="text-xl font-bold mb-4">{team.teamName}</h2>
            <div className="grid grid-rows-[repeat(auto-fill,minmax(40px,1fr))] gap-2">
              {team.players
                .sort((a, b) => a.draftPick - b.draftPick)
                .map((player) => (
                  <div 
                    key={player.id} 
                    className="flex justify-between items-center p-2 bg-gray-50 rounded"
                  >
                    {isEditing ? (
                      <div className="flex w-full gap-2 items-center">
                        <span className="text-xs text-gray-500 w-16">Pick {player.draftPick}</span>
                        <select
                          value={player.id}
                          onChange={(e) => handlePlayerChange(teamId, player.id, e.target.value)}
                          className="flex-1 p-1 text-sm border rounded min-w-[200px]"
                        >
                          {Object.values(players)
                            .flat()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.teamName})
                              </option>
                            ))}
                        </select>
                        <span className="text-xs text-gray-500 w-16">#{player.id}</span>
                        <span className="text-xs text-gray-500 w-32">
                          {player.currentTeam}
                        </span>
                      </div>
                    ) : (
                      <div className="flex w-full items-center gap-2">
                        <span className="text-xs text-gray-500 w-16">Pick {player.draftPick}</span>
                        <span className="text-sm flex-1">{player.name}</span>
                        <span className="text-xs text-gray-600 w-12">#{player.id}</span>
                        <span className="text-xs text-gray-600 w-24">
                          {player.currentTeam}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
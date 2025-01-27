'use client'

import { useState, useEffect } from 'react';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

export default function Squads() {
  const [squads, setSquads] = useState({});
  const [editedSquads, setEditedSquads] = useState({});
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
        
        setSquads(squadsData);
        setEditedSquads(squadsData);
        setPlayers(playersData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handlePlayerChange = (userId, playerIndex, newPlayerName) => {
    setEditedSquads(prev => {
      const newSquads = {...prev};
      const user = newSquads[userId];
      
      if (user && user.players[playerIndex]) {
        const allPlayers = Object.values(players).flat();
        const newPlayerData = allPlayers.find(p => p.name === newPlayerName);
        if (newPlayerData) {
          user.players[playerIndex] = {
            name: newPlayerData.name,
            team: newPlayerData.teamName
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
        body: JSON.stringify(editedSquads)
      });

      if (!response.ok) throw new Error('Failed to save');
      setSquads(editedSquads);
      setIsEditing(false);
    } catch (err) {
      setError('Failed to save changes');
    }
  };

  const handleCancel = () => {
    setEditedSquads(squads);
    setIsEditing(false);
  };

  if (loading) return <div className="p-4">Loading squads...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  const displaySquads = isEditing ? editedSquads : squads;

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
              Edit Squads
            </button>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Object.entries(displaySquads).map(([userId, user]) => (
          <div key={userId} className="bg-white rounded-lg shadow-md p-4 grid grid-rows-[auto_1fr]">
            <h2 className="text-xl font-bold mb-4">{USER_NAMES[userId] || `User ${userId}`}</h2>
            <div className="grid grid-rows-[repeat(auto-fill,minmax(40px,1fr))] gap-2">
              {user.players.map((player, index) => (
                <div 
                  key={index}
                  className="flex justify-between items-center p-2 bg-gray-50 rounded"
                >
                  {isEditing ? (
                    <select
                      value={player.name || ''}
                      onChange={(e) => handlePlayerChange(userId, index, e.target.value)}
                      className="w-full p-1 text-sm border rounded"
                    >
                      <option value="">Select Player</option>
                      {Object.values(players)
                        .flat()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(p => (
                          <option key={p.name} value={p.name}>
                            {p.name} ({p.teamName})
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span className="text-sm">{player.name} ({player.team})</span>
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
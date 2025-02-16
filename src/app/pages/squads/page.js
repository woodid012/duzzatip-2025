'use client'

import { useState, useEffect } from 'react';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

const SQUAD_SIZE = 18;

export default function Squads() {
  const [squads, setSquads] = useState({});
  const [editedSquads, setEditedSquads] = useState({});
  const [players, setPlayers] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [loadingSquads, setLoadingSquads] = useState(true);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [error, setError] = useState(null);

  // First, fetch squads
  useEffect(() => {
    const fetchSquads = async () => {
      try {
        const squadsRes = await fetch('/api/squads');
        if (!squadsRes.ok) throw new Error('Failed to fetch squads');
        
        const squadsData = await squadsRes.json();
        // Ensure each squad has exactly 18 players
        const paddedSquads = Object.entries(squadsData).reduce((acc, [userId, userData]) => {
          acc[userId] = {
            ...userData,
            players: Array(SQUAD_SIZE).fill(null).map((_, i) => 
              userData.players[i] || { name: '', team: '' }
            )
          };
          return acc;
        }, {});
        
        setSquads(paddedSquads);
        setEditedSquads(paddedSquads);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingSquads(false);
      }
    };

    fetchSquads();
  }, []);

  // Then, fetch players after squads are loaded
  useEffect(() => {
    if (!loadingSquads && !error) {
      const fetchPlayers = async () => {
        setLoadingPlayers(true);
        try {
          const playersRes = await fetch('/api/players');
          if (!playersRes.ok) throw new Error('Failed to fetch players');
          
          const playersData = await playersRes.json();
          setPlayers(playersData);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoadingPlayers(false);
        }
      };

      fetchPlayers();
    }
  }, [loadingSquads, error]);

  const handlePlayerChange = (userId, playerIndex, newPlayerName) => {
    if (userId !== selectedUserId) return; // Only allow changes for selected user
    
    setEditedSquads(prev => {
      const newSquads = {...prev};
      const user = newSquads[userId];
      
      if (user) {
        const allPlayers = Object.values(players).flat();
        const newPlayerData = allPlayers.find(p => p.name === newPlayerName);
        user.players[playerIndex] = newPlayerData 
          ? { name: newPlayerData.name, team: newPlayerData.teamName }
          : { name: '', team: '' };
      }
      
      return newSquads;
    });
  };

  const handleSave = async () => {
    try {
      // Only save the selected user's squad
      const updatedSquad = {
        [selectedUserId]: editedSquads[selectedUserId]
      };
      
      const response = await fetch('/api/squads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedSquad)
      });

      if (!response.ok) throw new Error('Failed to save');
      setSquads(prev => ({
        ...prev,
        [selectedUserId]: editedSquads[selectedUserId]
      }));
      setIsEditing(false);
      setSelectedUserId(null);
    } catch (err) {
      setError('Failed to save changes');
    }
  };

  const handleCancel = () => {
    setEditedSquads(squads);
    setIsEditing(false);
    setSelectedUserId(null);
  };

  const handleEditStart = (userId) => {
    // If the user doesn't have a squad yet, initialize an empty one
    if (!squads[userId]) {
      setSquads(prev => ({
        ...prev,
        [userId]: {
          players: Array(SQUAD_SIZE).fill(null).map(() => ({ name: '', team: '' }))
        }
      }));
      setEditedSquads(prev => ({
        ...prev,
        [userId]: {
          players: Array(SQUAD_SIZE).fill(null).map(() => ({ name: '', team: '' }))
        }
      }));
    }
    setSelectedUserId(userId);
    setIsEditing(true);
  };

  if (loadingSquads) return <div className="p-4">Loading squads...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  const displaySquads = isEditing ? editedSquads : squads;

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-black">DuzzaTip Squads {CURRENT_YEAR}</h1>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {isEditing ? (
            <>
              <button 
                onClick={handleSave}
                className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-green-600 text-white rounded hover:bg-green-700 text-lg sm:text-base"
              >
                Save Changes
              </button>
              <button 
                onClick={handleCancel}
                className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-lg sm:text-base"
              >
                Cancel
              </button>
            </>
          ) : (
            <select
              onChange={(e) => handleEditStart(e.target.value)}
              value=""
              className="w-full sm:w-auto px-4 py-3 sm:py-2 border rounded text-lg sm:text-base"
              disabled={loadingPlayers}
            >
              <option value="">Select User to Edit</option>
              {['1', '2', '3', '4', '5', '6', '7', '8'].map(userId => (
                <option key={userId} value={userId}>
                  {USER_NAMES[userId] || `User ${userId}`}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8'].map((userId) => {
          const user = displaySquads[userId] || { players: Array(SQUAD_SIZE).fill(null).map(() => ({ name: '', team: '' })) };
          return (
          <div key={userId} className="bg-white rounded-lg shadow-md p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg sm:text-xl font-bold text-black">{USER_NAMES[userId] || `User ${userId}`}</h2>
              <button 
                onClick={() => {
                  const element = document.getElementById(`squad-${userId}`);
                  if (element) {
                    element.classList.toggle('hidden');
                  }
                }}
                className="text-black hover:text-black sm:hidden"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <div id={`squad-${userId}`} className="space-y-2">
              {user.players.map((player, index) => (
                <div 
                  key={index}
                  className="flex items-center"
                >
                  {isEditing && userId === selectedUserId ? (
                    loadingPlayers ? (
                      <div className="w-full p-2 text-sm text-black border border-gray-200 rounded bg-white">
                        Loading players...
                      </div>
                    ) : (
                      <select
                        value={player.name || ''}
                        onChange={(e) => handlePlayerChange(userId, index, e.target.value)}
                        className="w-full p-2 text-sm border rounded bg-white text-black"
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
                    )
                  ) : (
                    <div className="w-full p-2 text-sm border border-gray-200 rounded bg-white">
                      <span className="text-black">
                        {player.name 
                          ? `${player.name} (${player.team})`
                          : <span className="text-gray-400">Empty slot</span>
                        }
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
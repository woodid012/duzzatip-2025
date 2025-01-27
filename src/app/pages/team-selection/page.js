'use client'

import { useState, useEffect } from 'react';
import { CURRENT_YEAR, USER_NAMES, POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';

export default function TeamSelection() {
  const [teams, setTeams] = useState({});
  const [editedTeams, setEditedTeams] = useState({});
  const [squads, setSquads] = useState({});
  const [round, setRound] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [teamsRes, squadsRes] = await Promise.all([
          fetch(`/api/team-selection?round=${round}&year=${CURRENT_YEAR}`),
          fetch('/api/squads')
        ]);

        if (!teamsRes.ok || !squadsRes.ok) throw new Error('Failed to fetch');
        
        const teamsData = await teamsRes.json();
        const squadsData = await squadsRes.json();
        
        setTeams(teamsData);
        setEditedTeams(teamsData);
        setSquads(squadsData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [round]);

  const handlePlayerChange = (userId, position, newPlayerName) => {
    setEditedTeams(prev => {
      const newTeams = {...prev};
      if (!newTeams[userId]) newTeams[userId] = {};
      
      const userSquad = squads[userId]?.players || [];
      const playerData = userSquad.find(p => p.name === newPlayerName);

      if (playerData) {
        newTeams[userId][position] = {
          player_name: playerData.name,
          position: position,
          team: playerData.team,
          last_updated: new Date().toISOString()
        };
      }
      
      return newTeams;
    });
  };

  const handleBackupPositionChange = (userId, newPosition) => {
    setEditedTeams(prev => {
      const newTeams = {...prev};
      if (!newTeams[userId]) newTeams[userId] = {};
      if (!newTeams[userId]['Bench']) return newTeams;

      newTeams[userId]['Bench'] = {
        ...newTeams[userId]['Bench'],
        backup_position: newPosition
      };
      
      return newTeams;
    });
  };

  const handleSave = async () => {
    try {
      console.log('Saving:', {
        year: CURRENT_YEAR,
        round: round,
        team_selection: editedTeams
      });
      const response = await fetch('/api/team-selection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          year: CURRENT_YEAR,
          round: parseInt(round),
          team_selection: editedTeams
        })
      });

      if (!response.ok) throw new Error('Failed to save');
      setTeams(editedTeams);
      setIsEditing(false);
    } catch (err) {
      setError('Failed to save changes');
    }
  };

  const handleCancel = () => {
    setEditedTeams(teams);
    setIsEditing(false);
  };

  if (loading) return <div className="p-4">Loading teams...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  const displayTeams = isEditing ? editedTeams : teams;

  return (
    <div className="p-6 w-full mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Team Selection Round {round}</h1>
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
              Edit Teams
            </button>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Object.entries(USER_NAMES).map(([userId, userName]) => (
          <div key={userId} className="bg-white rounded-lg shadow-md p-4">
            <h2 className="text-xl font-bold mb-4">{userName}</h2>
            <div className="space-y-2">
              {POSITION_TYPES.map((position) => {
                const playerData = displayTeams[userId]?.[position];
                const userSquad = squads[userId]?.players || [];
                
                return (
                  <div key={position} className="flex flex-col gap-1">
                    <label className="text-sm font-medium">{position}</label>
                    <div className="flex gap-2">
                      {isEditing ? (
                        <>
                          <select
                            value={playerData?.player_name || ''}
                            onChange={(e) => handlePlayerChange(userId, position, e.target.value)}
                            className="w-full p-1 text-sm border rounded"
                          >
                            <option value="">Select Player</option>
                            {userSquad
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map(p => (
                                <option key={p.name} value={p.name}>
                                  {p.name} ({p.team})
                                </option>
                              ))}
                          </select>
                          {position === 'Bench' && (
                            <select
                              value={playerData?.backup_position || ''}
                              onChange={(e) => handleBackupPositionChange(userId, e.target.value)}
                              className="w-1/3 p-1 text-sm border rounded"
                            >
                              <option value="">Backup Position</option>
                              {BACKUP_POSITIONS.map(pos => (
                                <option key={pos} value={pos}>{pos}</option>
                              ))}
                            </select>
                          )}
                        </>
                      ) : (
                        <div className="w-full p-1 text-sm">
                          {playerData ? (
                            <>
                              {playerData.player_name}
                              {position === 'Bench' && playerData.backup_position && 
                                ` (${playerData.backup_position})`}
                            </>
                          ) : '-'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
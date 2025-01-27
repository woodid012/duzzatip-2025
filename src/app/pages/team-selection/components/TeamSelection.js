'use client'

import { useState, useEffect } from 'react';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import TeamCard from './TeamCard';

export default function TeamSelection() {
  const [squadPlayers, setSquadPlayers] = useState({});
  const [allPlayers, setAllPlayers] = useState({});
  const [teamSelection, setTeamSelection] = useState({});
  const [editedTeamSelection, setEditedTeamSelection] = useState({});
  const [currentRound, setCurrentRound] = useState(1);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [duplicateErrors, setDuplicateErrors] = useState([]);
  const users = [1, 2, 3, 4, 5, 6, 7, 8];

  const fetchData = async (round = currentRound) => {
    try {
      setLoading(true);
      
      const [squadsRes, playersRes, teamSelectionRes] = await Promise.all([
        fetch('/api/squads'),
        fetch('/api/players'),
        fetch(`/api/team-selection?year=${CURRENT_YEAR}&round=${round}`)
      ]);

      if (!squadsRes.ok || !playersRes.ok || !teamSelectionRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const squadPlayersData = await squadsRes.json();
      const playersData = await playersRes.json();
      const teamSelectionData = await teamSelectionRes.json();

      setSquadPlayers(squadPlayersData);
      setAllPlayers(playersData);
      
      const updatedTeamSelection = {};
      Object.entries(teamSelectionData).forEach(([user, positions]) => {
        updatedTeamSelection[user] = {};
        Object.entries(positions).forEach(([position, playerData]) => {
          updatedTeamSelection[user][position] = {
            player_name: playerData.player_name,
            position: position,
            last_updated: playerData.last_updated,
            ...(playerData.backup_position && { backup_position: playerData.backup_position })
          };
        });
      });

      setTeamSelection(updatedTeamSelection || {});
      setEditedTeamSelection(updatedTeamSelection || {});
      setLoading(false);
      return { squadPlayersData, playersData, teamSelectionData: updatedTeamSelection };
    } catch (err) {
      console.error('Fetch Data Error:', err);
      setError(err.message);
      setLoading(false);
      return null;
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentRound]);

  const handleCopyFromPrevious = async (user) => {
    try {
      if (currentRound <= 1) return;

      const prevRoundRes = await fetch(`/api/team-selection?year=${CURRENT_YEAR}&round=${currentRound - 1}`);
      
      if (!prevRoundRes.ok) {
        throw new Error('Failed to fetch previous round data');
      }

      const prevRoundData = await prevRoundRes.json();
      
      if (!prevRoundData[user]) {
        throw new Error('No data found for previous round');
      }

      setEditedTeamSelection(prev => {
        const newTeamSelection = { ...prev };
        newTeamSelection[user] = Object.entries(prevRoundData[user]).reduce((acc, [position, data]) => {
          acc[position] = {
            ...data,
            last_updated: new Date().toISOString()
          };
          return acc;
        }, {});
        return newTeamSelection;
      });
    } catch (err) {
      console.error('Copy from Previous Round Error:', err);
      setError('Failed to copy from previous round');
    }
  };

  const handlePlayerChange = (user, position, newPlayerName, backupPosition = null) => {
    setEditedTeamSelection(prev => {
      const newTeamSelection = {...prev};
      
      if (!newTeamSelection[user]) {
        newTeamSelection[user] = {};
      }
      
      const entryData = {
        player_name: newPlayerName,
        position: position,
        last_updated: new Date().toISOString()
      };

      if (position === 'Bench' && backupPosition) {
        entryData.backup_position = backupPosition;
      }

      newTeamSelection[user][position] = entryData;

      return newTeamSelection;
    });
  };

  const checkForDuplicates = () => {
    const duplicates = [];
    const playerCounts = new Map();

    Object.entries(editedTeamSelection).forEach(([userId, positions]) => {
      Object.entries(positions).forEach(([position, data]) => {
        if (data.player_name) {
          const key = data.player_name;
          if (!playerCounts.has(key)) {
            playerCounts.set(key, {
              count: 0,
              positions: [],
              name: data.player_name
            });
          }
          const current = playerCounts.get(key);
          current.count++;
          current.positions.push({
            user: userId,
            position: position
          });
          playerCounts.set(key, current);
        }
      });
    });

    playerCounts.forEach((value, key) => {
      if (value.count > 1) {
        duplicates.push({
          player: value.name,
          positions: value.positions
        });
      }
    });

    setDuplicateErrors(duplicates);
    return duplicates.length === 0;
  };

  const validateBenchPlayers = () => {
    const benchErrors = [];
    
    Object.entries(editedTeamSelection).forEach(([userId, positions]) => {
      const benchPlayer = positions['Bench'];
      if (benchPlayer?.player_name && !benchPlayer.backup_position) {
        benchErrors.push({
          user: userId,
          player: benchPlayer.player_name
        });
      }
    });

    return benchErrors;
  };

  const handleSave = async () => {
    checkForDuplicates();
    validateBenchPlayers();

    try {
      const response = await fetch('/api/team-selection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          year: CURRENT_YEAR,
          round: currentRound,
          team_selection: editedTeamSelection
        })
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to save');
      }

      setTeamSelection(editedTeamSelection);
      setIsEditing(false);
    } catch (err) {
      console.error('Save Error:', err);
      setError(err.message || 'Failed to save changes');
    }
  };

  const handleCancel = () => {
    setEditedTeamSelection(teamSelection);
    setIsEditing(false);
  };

  if (loading) return <div className="p-4">Loading team selection...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  return (
    <div className="p-6 w-full mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Team Selection {CURRENT_YEAR}</h1>
          {duplicateErrors.length > 0 && (
            <div className="mt-2 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <h3 className="text-yellow-700 font-semibold mb-2">Warning: Duplicate Player Selections</h3>
              <ul className="text-sm text-yellow-600">
                {duplicateErrors.map((duplicate, index) => (
                  <li key={index} className="mb-1">
                    {duplicate.player} selected in multiple positions:
                    {duplicate.positions.map((pos, i) => (
                      <span key={i} className="ml-1">
                        {USER_NAMES[pos.user]} ({pos.position}){i < duplicate.positions.length - 1 ? ',' : ''}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validateBenchPlayers().length > 0 && (
            <div className="mt-2 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <h3 className="text-yellow-700 font-semibold mb-2">Missing Bench Backup Positions:</h3>
              <ul className="text-sm text-yellow-600">
                {validateBenchPlayers().map((error, index) => (
                  <li key={index} className="mb-1">
                    {USER_NAMES[error.user]}: {error.player} needs a backup position set
                  </li>
                ))}
              </ul>
            </div>
          )}
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
                Edit Team Selection
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {users.map(user => (
          <TeamCard
            key={user}
            user={user}
            teamName={USER_NAMES[user]}
            teamSelection={teamSelection}
            editedTeamSelection={editedTeamSelection}
            squadPlayers={squadPlayers}
            isEditing={isEditing}
            onPlayerChange={handlePlayerChange}
            currentRound={currentRound}
            onCopyFromPrevious={handleCopyFromPrevious}
          />
        ))}
      </div>
    </div>
  );
}
'use client'

import { useState } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { useUserContext } from '../layout';
import useTeamSelection from '@/app/hooks/useTeamSelection';
import { USER_NAMES, POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';

export default function TeamSelectionPage() {
  // Get data from our app context
  const { currentRound, roundInfo, changeRound } = useAppContext();
  
  // Get selected user context
  const { selectedUserId } = useUserContext();
  
  // Get team selection functionality from our hook
  const {
    teams,
    squads,
    isEditing,
    loading,
    error,
    handlePlayerChange,
    handleBackupPositionChange,
    saveTeamSelections,
    cancelEditing,
    startEditing,
    copyFromPreviousRound
  } = useTeamSelection();

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    changeRound(newRound);
  };

  if (loading) return <div className="p-4">Loading teams...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  // If no user is selected and not admin, show a message
  if (!selectedUserId) {
    return (
      <div className="text-center p-10">
        <h2 className="text-2xl font-bold mb-4">Please Select a Player</h2>
        <p className="text-gray-600">
          Use the dropdown in the top right to select which player's team you want to view or edit.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <style jsx>{`
        select option[value=""] {
          color: #DC2626;
        }
      `}</style>
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-black">
            {selectedUserId && selectedUserId !== 'admin' 
              ? `${USER_NAMES[selectedUserId]}'s Team` 
              : 'Team Selection'}
          </h1>
          <div className="flex flex-col gap-1 mt-1">
            {roundInfo.lockoutTime && (
              <div className="text-sm">
                <span className="text-gray-600">Lockout:</span>
                <span className="font-medium text-black ml-1">{roundInfo.lockoutTime}</span>
                {roundInfo.isLocked && (
                  <span className="text-red-600 ml-1">(Locked)</span>
                )}
              </div>
            )}
            {Object.values(teams[selectedUserId] || {}).some(entry => entry.last_updated) && (
              <div className="text-sm">
                <span className="text-gray-600">Last Submitted:</span>
                <span className="font-medium text-black ml-1">
                  {new Date(Math.max(...Object.values(teams[selectedUserId] || {})
                    .filter(entry => entry.last_updated)
                    .map(entry => new Date(entry.last_updated))
                  )).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <label htmlFor="round-select" className="text-sm font-medium text-black mr-2">Round:</label>
            <select 
              id="round-select"
              value={currentRound}
              onChange={handleRoundChange}
              className="p-2 border rounded w-24 text-sm text-black"
            >
              {[...Array(29)].map((_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? 'Opening' : i}
                </option>
              ))}
            </select>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            {isEditing ? (
              <>
                <button 
                  onClick={saveTeamSelections}
                  className="w-full sm:w-auto px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Save Changes
                </button>
                <button 
                  onClick={cancelEditing}
                  className="w-full sm:w-auto px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button 
                onClick={startEditing}
                disabled={roundInfo.isLocked && selectedUserId !== 'admin'} // Only disable if locked AND not admin
                className={`w-full sm:w-auto px-4 py-2 rounded text-white ${
                  roundInfo.isLocked && selectedUserId !== 'admin'
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {roundInfo.isLocked && selectedUserId !== 'admin' ? 'Locked' : 'Edit Teams'}
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {/* Check if we have a selected user, otherwise show all teams */}
        {selectedUserId && selectedUserId !== 'admin' ? (
          // Show only the selected user's team
          <TeamCard 
            key={selectedUserId}
            userId={selectedUserId}
            userName={USER_NAMES[selectedUserId]}
            team={teams[selectedUserId] || {}}
            squad={squads[selectedUserId]?.players || []}
            isEditing={isEditing}
            isLocked={roundInfo.isLocked && selectedUserId !== 'admin'} // Only locked if not admin
            onPlayerChange={handlePlayerChange}
            onBackupPositionChange={handleBackupPositionChange}
            onCopyFromPrevious={() => currentRound > 1 && copyFromPreviousRound(selectedUserId)}
          />
        ) : (
          // Show all teams (for admin or when no user is selected)
          Object.entries(USER_NAMES).map(([userId, userName]) => (
            <TeamCard 
              key={userId}
              userId={userId}
              userName={userName}
              team={teams[userId] || {}}
              squad={squads[userId]?.players || []}
              isEditing={isEditing}
              isLocked={roundInfo.isLocked && selectedUserId !== 'admin'} // Only locked if not admin
              onPlayerChange={handlePlayerChange}
              onBackupPositionChange={handleBackupPositionChange}
              onCopyFromPrevious={() => currentRound > 1 && copyFromPreviousRound(userId)}
            />
          ))
        )}
      </div>
      
      {/* Reserve Rules Info - Moved below the teams */}
      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-semibold mb-2 text-blue-800">Reserve System</h3>
        <ul className="list-disc pl-5 text-blue-700 text-sm space-y-1">
          <li><strong>Reserve A</strong> automatically covers: Full Forward, Tall Forward, and Ruck positions if a player doesn't play</li>
          <li><strong>Reserve B</strong> automatically covers: Offensive, Midfielder, and Tackler positions if a player doesn't play</li>
          <li>Each reserve can only be used once if multiple players don't play</li>
          <li>Bench players with specific backup positions take priority over reserves</li>
        </ul>
      </div>
    </div>
  );
}

// Team card component
function TeamCard({ 
  userId, 
  userName, 
  team, 
  squad, 
  isEditing, 
  isLocked,
  onPlayerChange, 
  onBackupPositionChange,
  onCopyFromPrevious
}) {
  // State for toggling visibility on mobile
  const [isExpanded, setIsExpanded] = useState(true);

  // Get display name for each position
  const getPositionDisplay = (position) => {
    if (position === 'Reserve A') return 'Reserve A - FF/TF/Ruck';
    if (position === 'Reserve B') return 'Reserve B - Off/Mid/Tackler';
    return position;
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg sm:text-xl font-bold text-black">{userName}</h2>
        <div className="flex items-center gap-2">
          {isEditing && (
            <button
              onClick={onCopyFromPrevious}
              className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
              disabled={isLocked}
            >
              Copy Previous
            </button>
          )}
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-black hover:text-black sm:hidden"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExpanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
            </svg>
          </button>
        </div>
      </div>
      
      {isExpanded && (
        <div className="space-y-2">
          {POSITION_TYPES.map((position) => {
            const playerData = team[position];
            const displayPosition = getPositionDisplay(position);
            
            return (
              <div key={position} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-black">{displayPosition}</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  {isEditing ? (
                    <>
                      <select
                        value={playerData?.player_name || ''}
                        onChange={(e) => onPlayerChange(userId, position, e.target.value)}
                        className="w-full p-2 text-sm border rounded bg-white text-black"
                        disabled={isLocked}
                      >
                        <option value="">Select Player</option>
                        {squad
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
                          onChange={(e) => onBackupPositionChange(userId, position, e.target.value)}
                          className="w-full sm:w-1/3 p-2 text-sm border rounded bg-white text-black"
                          disabled={isLocked}
                        >
                          <option value="">Backup Position</option>
                          {BACKUP_POSITIONS.map(pos => (
                            <option key={pos} value={pos}>
                              {pos}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  ) : (
                    <div className="w-full p-2 text-sm border border-gray-200 rounded bg-white">
                      {playerData ? (
                        <div className="flex justify-between items-center">
                          <span className="text-black">{playerData.player_name}</span>
                          {position === 'Bench' && playerData.backup_position && (
                            <span className="text-black text-xs">
                              {playerData.backup_position}
                            </span>
                          )}
                        </div>
                      ) : '-'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
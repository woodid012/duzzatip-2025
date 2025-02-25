'use client'

import { useState } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import useTeamSelection from '@/app/hooks/useTeamSelection';
import { USER_NAMES, POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';

export default function TeamSelectionPage() {
  // Get data from our app context
  const { currentRound, roundInfo, changeRound } = useAppContext();
  
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

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <style jsx>{`
        select option[value=""] {
          color: #DC2626;
        }
      `}</style>
      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-black">Team Selection</h1>
          <div className="w-full sm:w-auto flex flex-wrap items-center gap-2">
            <label htmlFor="round-select" className="text-sm font-medium text-black">Round:</label>
            <select 
              id="round-select"
              value={currentRound}
              onChange={handleRoundChange}
              className="p-2 border rounded w-24 text-lg text-black"
            >
              {[...Array(29)].map((_, i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <div className="flex flex-col text-sm gap-1">
              {roundInfo.lockoutTime && (
                <div>
                  <span className="text-gray-600">Lockout:</span>
                  <span className="font-medium text-black ml-1">{roundInfo.lockoutTime}</span>
                  {roundInfo.isLocked && (
                    <span className="text-red-600 ml-1">(Locked)</span>
                  )}
                </div>
              )}
              {roundInfo.roundEndTime && (
                <div>
                  <span className="text-gray-600">Round Ends:</span>
                  <span className="font-medium text-black ml-1">{roundInfo.roundEndTime}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {isEditing ? (
            <>
              <button 
                onClick={saveTeamSelections}
                className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-green-600 text-white rounded hover:bg-green-700 text-lg sm:text-base"
              >
                Save Changes
              </button>
              <button 
                onClick={cancelEditing}
                className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-lg sm:text-base"
              >
                Cancel
              </button>
            </>
          ) : (
            <button 
              onClick={startEditing}
              disabled={roundInfo.isLocked}
              className={`w-full sm:w-auto px-4 py-3 sm:py-2 ${
                roundInfo.isLocked 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700'
              } text-white rounded text-lg sm:text-base`}
            >
              {roundInfo.isLocked ? 'Locked' : 'Edit Teams'}
            </button>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Object.entries(USER_NAMES).map(([userId, userName]) => (
          <TeamCard 
            key={userId}
            userId={userId}
            userName={userName}
            team={teams[userId] || {}}
            squad={squads[userId]?.players || []}
            isEditing={isEditing}
            isLocked={roundInfo.isLocked}
            onPlayerChange={handlePlayerChange}
            onBackupPositionChange={handleBackupPositionChange}
            onCopyFromPrevious={() => currentRound > 1 && copyFromPreviousRound(userId)}
          />
        ))}
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
            
            return (
              <div key={position} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-black">{position}</label>
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
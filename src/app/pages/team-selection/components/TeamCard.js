'use client'

import { POSITION_TYPES, TEAM_NAMES, CURRENT_YEAR, BACKUP_POSITIONS } from '@/app/lib/constants';

export default function TeamCard({ 
  user,
  teamSelection,
  squadPlayers,
  isEditing,
  onPlayerChange,
  currentRound,
  onCopyFromPrevious
}) {
  return (
    <div className="bg-white rounded-lg shadow-md p-4 grid grid-rows-[auto_auto_1fr]">
      <div className="mb-4">
        <h2 className="text-xl font-bold">
          {squadPlayers[user]?.teamName || `Team ${user}`} (User {user})
        </h2>
        {Object.values(teamSelection[user] || {}).some(entry => entry.last_updated) && (
          <div className="text-xs text-gray-500 mt-1">
            Last updated: {new Date(Math.max(...Object.values(teamSelection[user] || {})
              .filter(entry => entry.last_updated)
              .map(entry => new Date(entry.last_updated))
            )).toLocaleString()}
          </div>
        )}
      </div>
      {isEditing && currentRound > 1 && (
        <button
          onClick={() => onCopyFromPrevious(user)}
          className="mb-4 px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300"
        >
          Copy from Round {currentRound - 1}
        </button>
      )}
      <div className="grid grid-rows-[repeat(auto-fill,minmax(40px,1fr))] gap-2">
        {POSITION_TYPES.map(position => (
          <div 
            key={position} 
            className="flex justify-between items-center p-2 bg-gray-50 rounded"
          >
            {isEditing ? (
              <div className="flex w-full gap-2 items-center">
                <span className="text-sm flex-1">{position}</span>
                <select
                  value={teamSelection[user]?.[position]?.player_id || ''}
                  onChange={(e) => onPlayerChange(user, position, e.target.value)}
                  className="flex-1 p-1 text-sm border rounded min-w-[200px]"
                >
                  <option value="">Select Player</option>
                  {squadPlayers[user]?.players?.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                
                {/* Backup Position Dropdown for Bench */}
                {position === 'Bench' && (
                  <select
                    value={teamSelection[user]?.[position]?.backup_position || ''}
                    onChange={(e) => {
                      const currentPlayerData = teamSelection[user]?.[position];
                      onPlayerChange(
                        user, 
                        position, 
                        currentPlayerData?.player_id || '', 
                        e.target.value
                      );
                    }}
                    className="ml-2 flex-1 p-1 text-sm border rounded min-w-[150px]"
                  >
                    <option value="">Backup Position</option>
                    {BACKUP_POSITIONS.map(backupPos => (
                      <option key={backupPos} value={backupPos}>
                        {backupPos}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div className="flex w-full items-center gap-2">
                <span className="text-sm flex-1">{position}</span>
                <span className="text-sm flex-1">
                  {teamSelection[user]?.[position]?.player_name || 'Not Selected'}
                </span>
                {position === 'Bench' && teamSelection[user]?.[position]?.backup_position && (
                  <span className="text-xs text-gray-500">
                    (Backup: {teamSelection[user]?.[position]?.backup_position})
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
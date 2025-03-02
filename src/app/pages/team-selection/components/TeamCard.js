// TeamCard component from team-selection/page.js

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

  // Force re-render when team changes
  useEffect(() => {
    console.log(`TeamCard for ${userId} received updated team data:`, team);
  }, [team, userId]);

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
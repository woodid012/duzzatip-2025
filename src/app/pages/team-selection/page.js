'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { useUserContext } from '../layout';
import useTeamSelection from '@/app/hooks/useTeamSelection';
import { USER_NAMES, POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';

export default function TeamSelectionPage() {
  // Get just the current round from the app context for initial display
  const { currentRound, roundInfo } = useAppContext();
  
  // Get selected user context
  const { selectedUserId } = useUserContext();
  
  // Get team selection functionality from our hook
  const {
    teams,
    squads,
    isEditing,
    loading,
    error,
    localRound,
    isRoundLocked,
    handleRoundChange,
    handlePlayerChange,
    handleBackupPositionChange,
    saveTeamSelections,
    cancelEditing,
    startEditing,
    copyFromPreviousRound
  } = useTeamSelection();

  // State for duplicate warnings
  const [duplicateWarnings, setDuplicateWarnings] = useState([]);
  
  // State for fixture warnings (teams on bye)
  const [fixtureWarnings, setFixtureWarnings] = useState([]);
  
  // Admin override state - separate from the hook's isEditing
  const [adminEditMode, setAdminEditMode] = useState(false);
  
  // Initialize with global current round on first render
  useEffect(() => {
    if (currentRound !== undefined && localRound === undefined) {
      handleRoundChange(currentRound);
    }
  }, [currentRound, localRound, handleRoundChange]);

  // Check for teams on bye (no fixtures for the round)
  useEffect(() => {
    const checkFixtures = async () => {
      if (!teams || Object.keys(teams).length === 0) return;
      
      // Collect all unique team names from all players selected
      const allTeamNames = new Set();
      
      if (selectedUserId && selectedUserId !== 'admin' && teams[selectedUserId]) {
        // For single user, check their team selections
        const userTeam = teams[selectedUserId];
        Object.values(userTeam).forEach(data => {
          if (data && data.player_name && squads[selectedUserId]) {
            const player = squads[selectedUserId].players.find(p => p.name === data.player_name);
            if (player && player.team) {
              allTeamNames.add(player.team);
            }
          }
        });
      } else if (selectedUserId === 'admin') {
        // For admin, check all teams
        Object.entries(teams).forEach(([userId, userTeam]) => {
          Object.values(userTeam).forEach(data => {
            if (data && data.player_name && squads[userId]) {
              const player = squads[userId].players.find(p => p.name === data.player_name);
              if (player && player.team) {
                allTeamNames.add(player.team);
              }
            }
          });
        });
      }
      
      if (allTeamNames.size === 0) {
        setFixtureWarnings([]);
        return;
      }
      
      try {
        const response = await fetch(`/api/check-fixtures?round=${localRound}&teams=${Array.from(allTeamNames).join(',')}`);
        if (response.ok) {
          const data = await response.json();
          const warnings = [];
          
          // Check which teams don't have fixtures
          Object.entries(data.teamFixtureStatus).forEach(([teamName, status]) => {
            if (!status.hasFixture) {
              // Find which players are from this team
              const playersOnBye = [];
              
              if (selectedUserId && selectedUserId !== 'admin' && teams[selectedUserId]) {
                const userTeam = teams[selectedUserId];
                Object.entries(userTeam).forEach(([position, playerData]) => {
                  if (playerData && playerData.player_name && squads[selectedUserId]) {
                    const player = squads[selectedUserId].players.find(p => p.name === playerData.player_name);
                    if (player && player.team === teamName) {
                      playersOnBye.push({
                        userId: selectedUserId,
                        userName: USER_NAMES[selectedUserId],
                        position,
                        playerName: playerData.player_name
                      });
                    }
                  }
                });
              } else if (selectedUserId === 'admin') {
                Object.entries(teams).forEach(([userId, userTeam]) => {
                  Object.entries(userTeam).forEach(([position, playerData]) => {
                    if (playerData && playerData.player_name && squads[userId]) {
                      const player = squads[userId].players.find(p => p.name === playerData.player_name);
                      if (player && player.team === teamName) {
                        playersOnBye.push({
                          userId,
                          userName: USER_NAMES[userId],
                          position,
                          playerName: playerData.player_name
                        });
                      }
                    }
                  });
                });
              }
              
              if (playersOnBye.length > 0) {
                warnings.push({
                  teamName,
                  players: playersOnBye
                });
              }
            }
          });
          
          setFixtureWarnings(warnings);
        }
      } catch (error) {
        console.error('Error checking fixtures:', error);
        setFixtureWarnings([]);
      }
    };
    
    // Only check fixtures if we have team data and squad data
    if (teams && squads && Object.keys(squads).length > 0) {
      checkFixtures();
    }
  }, [teams, squads, localRound, selectedUserId]);

  // Check for duplicate players in the team selections
  useEffect(() => {
    if (teams && Object.keys(teams).length > 0) {
      // Only check duplicates for the selected user
      if (selectedUserId && selectedUserId !== 'admin' && teams[selectedUserId]) {
        const userTeam = teams[selectedUserId];
        const playerCounts = {};
        const duplicates = [];

        // Count occurrences of each player
        Object.entries(userTeam).forEach(([position, data]) => {
          // Add null check before accessing player_name - this fixes the error
          if (!data || !data.player_name) return;
          
          const playerName = data.player_name;
          
          if (!playerCounts[playerName]) {
            playerCounts[playerName] = {
              count: 0,
              positions: []
            };
          }
          
          playerCounts[playerName].count++;
          playerCounts[playerName].positions.push(position);
        });

        // Find players that appear more than once
        Object.entries(playerCounts).forEach(([playerName, info]) => {
          if (info.count > 1) {
            duplicates.push({
              playerName,
              positions: info.positions
            });
          }
        });

        setDuplicateWarnings(duplicates);
      } else if (selectedUserId === 'admin') {
        // For admin view, check all teams
        const allDuplicates = [];
        
        Object.entries(teams).forEach(([userId, userTeam]) => {
          const playerCounts = {};
          
          // Count occurrences of each player
          Object.entries(userTeam).forEach(([position, data]) => {
            // Add null check before accessing player_name - this fixes the error
            if (!data || !data.player_name) return;
            
            const playerName = data.player_name;
            
            if (!playerCounts[playerName]) {
              playerCounts[playerName] = {
                count: 0,
                positions: []
              };
            }
            
            playerCounts[playerName].count++;
            playerCounts[playerName].positions.push(position);
          });

          // Find players that appear more than once
          Object.entries(playerCounts).forEach(([playerName, info]) => {
            if (info.count > 1) {
              allDuplicates.push({
                userId,
                userName: USER_NAMES[userId],
                playerName,
                positions: info.positions
              });
            }
          });
        });

        setDuplicateWarnings(allDuplicates);
      } else {
        setDuplicateWarnings([]);
      }
    }
  }, [teams, selectedUserId]);

  // Admin edit handlers
  const handleAdminEditClick = () => {
    if (selectedUserId === 'admin') {
      setAdminEditMode(true);
    } else {
      startEditing();
    }
  };

  const handleAdminSave = async () => {
    if (selectedUserId === 'admin') {
      const success = await saveTeamSelections();
      if (success) {
        setAdminEditMode(false);
      }
      return success;
    } else {
      return await saveTeamSelections();
    }
  };

  const handleAdminCancel = () => {
    if (selectedUserId === 'admin') {
      setAdminEditMode(false);
    }
    cancelEditing();
  };

  // Handle save with confirmation for duplicates and fixture warnings
  const handleSaveWithWarning = async () => {
    const warnings = [];
    
    // Check for duplicates
    if (duplicateWarnings.length > 0) {
      warnings.push(`${duplicateWarnings.length} duplicate player selections`);
    }
    
    // Check for fixture warnings (teams on bye)
    if (fixtureWarnings.length > 0) {
      const totalPlayersOnBye = fixtureWarnings.reduce((total, warning) => total + warning.players.length, 0);
      warnings.push(`${totalPlayersOnBye} players from teams that have a BYE this round`);
    }
    
    if (warnings.length > 0) {
      const warningMessage = `Warning: You have ${warnings.join(' and ')}. ` +
        (fixtureWarnings.length > 0 ? 'Players from teams on bye will score 0 points. ' : '') +
        'Do you want to save anyway?';
        
      if (confirm(warningMessage)) {
        return await handleAdminSave();
      }
      return false;
    } else {
      return await handleAdminSave();
    }
  };

  // Format date for display
  const formatDate = (date) => {
    if (!date) return 'Never';
    
    return new Date(date).toLocaleString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    });
  };

  // Get the most recent update time from the team data
  const getLastUpdateTime = () => {
    if (!selectedUserId || !teams[selectedUserId]) return null;
    
    // Check for the _lastUpdated property first (from our updated API)
    if (teams[selectedUserId]._lastUpdated) {
      return new Date(teams[selectedUserId]._lastUpdated);
    }
    
    // Fallback: look through all positions for last_updated values
    const teamData = teams[selectedUserId];
    const updateTimes = Object.values(teamData)
      .filter(entry => entry && entry.last_updated)
      .map(entry => new Date(entry.last_updated));
    
    if (updateTimes.length === 0) return null;
    
    // Return the most recent update time
    return new Date(Math.max(...updateTimes));
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

  // Format the round name nicely
  const formatRoundName = (round) => {
    if (round === 0) return "Opening Round";
    return `Round ${round}`;
  };

  // Get last updated time
  const lastUpdatedTime = getLastUpdateTime();

  // Is admin flag for simplified checking
  const isAdmin = selectedUserId === 'admin';
  
  // Determine if we're in edit mode (either regular editing or admin edit mode)
  const inEditMode = isEditing || adminEditMode;
  
  // Check if editing is allowed (admin can always edit, regular users only if not locked)
  const canEdit = isAdmin || !isRoundLocked;
  
  // For TeamCard props - admin should never be locked when in edit mode
  const isTeamCardLocked = isAdmin ? false : isRoundLocked;

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
          
          {/* Show which round we're displaying with improved formatting - matching tipping page style */}
          <div className="flex flex-col gap-1 mt-1">
            <div className="text-sm font-medium">
              {isRoundLocked && !isAdmin ? (
                <>
                  <span className="text-red-600">
                    {formatRoundName(currentRound)} is locked 
                  </span>
                  <span className="text-gray-600 ml-1">
                    - Showing {formatRoundName(localRound)}
                  </span>
                </>
              ) : (
                <span className="text-green-600">
                  Showing {formatRoundName(localRound)}
                </span>
              )}
              
              {isAdmin && isRoundLocked && (
                <span className="ml-2 text-orange-500 font-medium">
                  (Normally locked, admin override enabled)
                </span>
              )}
            </div>
            
            {/* Lockout time with formatting that matches tipping page */}
            {roundInfo && roundInfo.lockoutTime && (
              <div className="text-sm">
                <span className="text-gray-600">Lockout:</span>
                <span className="font-medium text-black ml-1">{roundInfo.lockoutTime}</span>
                {isRoundLocked && !isAdmin && (
                  <span className="text-red-600 ml-1">(Locked)</span>
                )}
              </div>
            )}
            
            {/* Last update info, matching tipping page style exactly */}
            {lastUpdatedTime && (
              <div className="text-sm">
                <span className="text-gray-600">Last Submitted:</span>
                <span className="font-medium text-black ml-1">
                  {formatDate(lastUpdatedTime)}
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
              value={localRound}
              onChange={(e) => handleRoundChange(Number(e.target.value))}
              className="p-2 border rounded w-24 text-sm text-black"
              disabled={inEditMode && !isAdmin} // Only disable for non-admin when editing
            >
              {[...Array(29)].map((_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? 'Opening' : i}
                </option>
              ))}
            </select>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            {inEditMode ? (
              <>
                <button 
                  onClick={handleSaveWithWarning}
                  className="w-full sm:w-auto px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Save Changes
                </button>
                <button 
                  onClick={handleAdminCancel}
                  className="w-full sm:w-auto px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button 
                onClick={handleAdminEditClick}
                disabled={!canEdit}
                className={`w-full sm:w-auto px-4 py-2 rounded text-white ${
                  !canEdit
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {!canEdit ? 'Locked' : 'Edit Teams'}
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Display warning for teams on bye */}
      {fixtureWarnings.length > 0 && (
        <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <h3 className="text-md font-semibold text-red-800">Warning: Teams on BYE</h3>
          </div>
          
          <div className="text-red-700">
            <p className="mb-2">The following players are from teams that have a BYE in Round {localRound}:</p>
            <div className="space-y-2">
              {fixtureWarnings.map((warning, idx) => (
                <div key={idx} className="bg-white p-3 rounded border border-red-200">
                  <p className="font-semibold text-red-800 mb-1">{warning.teamName} (BYE)</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {warning.players.map((player, playerIdx) => (
                      <li key={playerIdx}>
                        <strong>{selectedUserId === 'admin' ? `${player.userName}: ` : ''}</strong>
                        {player.playerName} ({player.position})
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-3 font-medium bg-red-100 p-2 rounded">
              ⚠️ Players from teams on BYE will score 0 points as they won't play this round.
            </p>
          </div>
        </div>
      )}
      
      {/* Display warning for duplicate players */}
      {duplicateWarnings.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-300 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <h3 className="text-md font-semibold text-yellow-800">Warning: Duplicate Player Selections</h3>
          </div>
          
          <div className="text-yellow-700">
            <p className="mb-2">The following players are selected in multiple positions:</p>
            <ul className="list-disc pl-5 space-y-1">
              {selectedUserId && selectedUserId !== 'admin' ? (
                // Display duplicates for selected user
                duplicateWarnings.map((warning, idx) => (
                  <li key={idx}>
                    <strong>{warning.playerName}</strong> is selected in: {warning.positions.join(', ')}
                  </li>
                ))
              ) : (
                // Display duplicates for all users (admin view)
                duplicateWarnings.map((warning, idx) => (
                  <li key={idx}>
                    <strong>{warning.userName}</strong>: {warning.playerName} is selected in: {warning.positions.join(', ')}
                  </li>
                ))
              )}
            </ul>
            <p className="mt-3 font-medium">These duplicates will still be saved, but may affect scoring.</p>
          </div>
        </div>
      )}
      
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
            isEditing={inEditMode}
            isLocked={isTeamCardLocked}
            onPlayerChange={handlePlayerChange}
            onBackupPositionChange={handleBackupPositionChange}
            onCopyFromPrevious={() => copyFromPreviousRound(selectedUserId)}
            duplicateWarnings={duplicateWarnings}
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
              isEditing={inEditMode}
              isLocked={isTeamCardLocked}
              onPlayerChange={handlePlayerChange}
              onBackupPositionChange={handleBackupPositionChange}
              onCopyFromPrevious={() => copyFromPreviousRound(userId)}
              duplicateWarnings={duplicateWarnings}
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
      
      {/* Admin Controls Section - Only shown when admin is active */}
      {isAdmin && (
        <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h3 className="text-lg font-semibold mb-2 text-amber-800">Admin Controls</h3>
          <p className="text-amber-700">
            As an admin user, you can edit and save team selections for any round, regardless of whether 
            it's locked for regular users. This allows you to fix issues or make adjustments as needed.
          </p>
          <div className="mt-4 bg-white p-3 rounded border border-amber-200">
            <p className="font-medium text-amber-800">Current Admin Settings:</p>
            <ul className="list-disc pl-5 mt-2 text-sm space-y-1">
              <li><span className="font-medium">Round Status:</span> {isRoundLocked ? 'Locked for regular users' : 'Unlocked'}</li>
              <li><span className="font-medium">Admin Override:</span> Enabled</li>
              <li><span className="font-medium">Edit Capabilities:</span> Full access to all teams and rounds</li>
              <li><span className="font-medium">Current Mode:</span> {inEditMode ? 'Editing Mode' : 'View Mode'}</li>
            </ul>
          </div>
        </div>
      )}
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
  onCopyFromPrevious,
  duplicateWarnings
}) {
  // State for toggling visibility on mobile
  const [isExpanded, setIsExpanded] = useState(true);
  const [key, setKey] = useState(0);

  // Get display name for each position
  const getPositionDisplay = (position) => {
    if (position === 'Reserve A') return 'Reserve A - FF/TF/Ruck';
    if (position === 'Reserve B') return 'Reserve B - Off/Mid/Tackler';
    return position;
  };

  // Force re-render when team changes
  useEffect(() => {
    setKey(prevKey => prevKey + 1);
  }, [team]);

  // Copy from previous with UI feedback
  const handleCopyFromPrevious = () => {
    console.log(`Copying previous round for user ${userId}`);
    onCopyFromPrevious();
  };

  // Check if a player is duplicated in this team
  const isDuplicatePlayer = (playerName, position) => {
    if (!playerName || !duplicateWarnings || duplicateWarnings.length === 0) return false;
    
    // For a single user view
    if (Array.isArray(duplicateWarnings) && duplicateWarnings[0] && !duplicateWarnings[0].userId) {
      const duplicate = duplicateWarnings.find(d => d.playerName === playerName);
      return duplicate && duplicate.positions.includes(position);
    }
    
    // For admin view
    return duplicateWarnings.some(d => 
      d.userId === userId && 
      d.playerName === playerName && 
      d.positions.includes(position)
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-3 sm:p-4" key={`team-${userId}-${key}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg sm:text-xl font-bold text-black">{userName}</h2>
        <div className="flex items-center gap-2">
          {isEditing && (
            <button
              onClick={handleCopyFromPrevious}
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
            // Add null check here - this is key to fixing the error
            const playerData = team[position] || null;
            const displayPosition = getPositionDisplay(position);
            // Use optional chaining to safely access player_name
            const isDuplicate = playerData?.player_name ? 
              isDuplicatePlayer(playerData.player_name, position) : false;
            
            return (
              <div key={`${position}-${playerData?.player_name || 'empty'}-${key}`} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-black">{displayPosition}</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  {isEditing ? (
                    <>
                      <select
                        value={playerData?.player_name || ''}
                        onChange={(e) => onPlayerChange(userId, position, e.target.value)}
                        className={`w-full p-2 text-sm border rounded bg-white text-black ${
                          isDuplicate ? 'border-red-500 bg-red-50' : ''
                        }`}
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
                    <div className={`w-full p-2 text-sm border rounded bg-white ${
                      isDuplicate ? 'border-red-500 bg-red-50' : 'border-gray-200'
                    }`}>
                      {playerData ? (
                        <div className="flex justify-between items-center">
                          <span className={`${isDuplicate ? 'text-red-600 font-semibold' : 'text-black'}`}>
                            {playerData.player_name}
                            {isDuplicate && " (Duplicate)"}
                          </span>
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
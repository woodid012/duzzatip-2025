'use client'

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR } from '@/app/lib/constants';

export default function useTeamSelection() {
  const { 
    currentRound, 
    roundInfo
  } = useAppContext();
  
  // Local round state - initialized from global current round but can be changed independently
  const [localRound, setLocalRound] = useState(currentRound);
  
  const [teams, setTeams] = useState({});
  const [editedTeams, setEditedTeams] = useState({});
  const [squads, setSquads] = useState({});
  const [changedPositions, setChangedPositions] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [errorLocal, setErrorLocal] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  // Initialize local round from global current round on first load
  useEffect(() => {
    if (localRound === undefined && currentRound !== undefined) {
      setLocalRound(currentRound);
    }
  }, [currentRound, localRound]);

  // Create stable fetch functions using useCallback
  const fetchSquads = useCallback(async () => {
    try {
      const response = await fetch('/api/squads');
      
      if (!response.ok) {
        
        return null;
      }
      
      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Error fetching squads:', err);
      return null;
    }
  }, []);

  const fetchTeamSelections = useCallback(async (round) => {
    try {
      // Add a small delay for API stability
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Ensure the round is a valid number
      const formattedRound = parseInt(round, 10);
      if (isNaN(formattedRound)) {
        
        return {};
      }
      
      
      
      // Clear error before making request
      setErrorLocal(null);
      
      const response = await fetch(`/api/team-selection?round=${formattedRound}`);
      
      if (!response.ok) {
        console.warn(`Team selection fetch response not OK: ${response.status}`);
        return {};
      }
      
      const data = await response.json();
      
      
      // Return empty object as fallback if no data
      return data || {};
    } catch (err) {
      console.error(`Error fetching team selections for round ${round}:`, err);
      setErrorLocal(`Error loading team data: ${err.message}`);
      // Return empty object as fallback
      return {};
    }
  }, []);

  // Determine if round is locked for editing
  // MODIFIED: Changed this function to ensure rounds remain locked forever once they're locked
  const isRoundLocked = useCallback((roundNumber) => {
    // If viewing opening round (0) and it's locked, it stays locked
    if (roundNumber === 0 && roundInfo.isLocked) {
      return true;
    }
    
    // If the round is less than the current round, it's always locked (historical round)
    if (roundNumber < currentRound) {
      return true;
    }
    
    // If this is the current round and it's locked by time
    if (roundInfo.isLocked && roundNumber === currentRound) {
      return true;
    }
    
    // Get lockout time for the specific round if available
    if (roundInfo.nextRoundLockoutDate && roundNumber > currentRound) {
      const now = new Date();
      const lockoutDate = new Date(roundInfo.nextRoundLockoutDate);
      
      // If the future round's lockout time has passed
      if (now > lockoutDate) {
        return true;
      }
    }
    
    // Otherwise this specific round is not locked
    return false;
  }, [roundInfo.isLocked, roundInfo.nextRoundLockoutDate, currentRound]);

  // Load data when local round changes
  useEffect(() => {
    let isMounted = true;
    
    const loadData = async () => {
      try {
        if (retryCount > 3) {
          // Stop retrying after 3 attempts
          setLoadingLocal(false);
          setErrorLocal('Failed to load data after multiple attempts');
          return;
        }
        
        if (localRound === undefined || localRound === null) {
          return;
        }
        
        setLoadingLocal(true);
        setErrorLocal(null);
        
        
        
        // Load team selections
        const teamsData = await fetchTeamSelections(localRound);
        
        // Only update state if component is still mounted
        if (!isMounted) return;
        
        if (teamsData && Object.keys(teamsData).length > 0) {
          
          setTeams(teamsData);
          setEditedTeams(teamsData);
        } else {
          // Set empty defaults if no data returned
          
          setTeams({});
          setEditedTeams({});
        }
        
        // Load squads if we don't have them yet
        if (Object.keys(squads).length === 0) {
          const squadData = await fetchSquads();
          if (squadData && isMounted) {
            setSquads(squadData);
          }
        }
        
        setLoadingLocal(false);
      } catch (err) {
        console.error('Error loading team selection data:', err);
        
        if (isMounted) {
          setErrorLocal(`Failed to load team data: ${err.message}`);
          setLoadingLocal(false);
          
          // Retry after a delay
          setTimeout(() => {
            if (isMounted) setRetryCount(prev => prev + 1);
          }, 1000);
        }
      }
    };

    loadData();
    
    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [localRound, fetchSquads, fetchTeamSelections, retryCount, squads]);

  // Reset retry count when local round changes
  useEffect(() => {
    setRetryCount(0);
  }, [localRound]);

  // Handle local round change
  const handleRoundChange = useCallback((newRound) => {
    
    setLocalRound(newRound);
    // Reset editing state when changing rounds
    setIsEditing(false);
    
    // Also reset any changes
    setChangedPositions({});
  }, []);

  // Handle player selection change
  const handlePlayerChange = useCallback((userId, position, newPlayerName) => {
    
    
    if (isRoundLocked(localRound) && userId !== 'admin') {
      
      return;
    }
    
    setEditedTeams(prev => {
      const newTeams = JSON.parse(JSON.stringify(prev)); // Deep clone
      if (!newTeams[userId]) newTeams[userId] = {};
      
      // If position doesn't exist or player is changing, update it
      if (!newTeams[userId][position] || newTeams[userId][position].player_name !== newPlayerName) {
        newTeams[userId][position] = {
          player_name: newPlayerName,
          position: position,
          ...(newTeams[userId][position]?.backup_position 
            ? { backup_position: newTeams[userId][position].backup_position } 
            : {}),
          last_updated: new Date().toISOString()
        };
      }
      
      return newTeams;
    });

    setChangedPositions(prev => {
      const newChangedPositions = { ...prev };
      if (!newChangedPositions[userId]) {
        newChangedPositions[userId] = {};
      }
      newChangedPositions[userId][position] = true;
      return newChangedPositions;
    });
    
    // Ensure we're in editing mode
    if (!isEditing) {
      setIsEditing(true);
    }
  }, [localRound, isRoundLocked, isEditing]);

  // Handle backup position change for bench players
  const handleBackupPositionChange = useCallback((userId, position, newPosition) => {
    
    
    if (isRoundLocked(localRound) && userId !== 'admin') {
      
      return;
    }
    
    setEditedTeams(prev => {
      const newTeams = JSON.parse(JSON.stringify(prev)); // Deep clone
      if (!newTeams[userId]) newTeams[userId] = {};
      if (!newTeams[userId][position]) {
        
        return newTeams;
      }

      newTeams[userId][position] = {
        ...newTeams[userId][position],
        backup_position: newPosition,
        last_updated: new Date().toISOString()
      };
      
      return newTeams;
    });

    setChangedPositions(prev => {
      const newChangedPositions = { ...prev };
      if (!newChangedPositions[userId]) {
        newChangedPositions[userId] = {};
      }
      newChangedPositions[userId][position] = true;
      return newChangedPositions;
    });
    
    // Ensure we're in editing mode
    if (!isEditing) {
      setIsEditing(true);
    }
  }, [localRound, isRoundLocked, isEditing]);

  // Copy from previous round
  const copyFromPreviousRound = useCallback(async (userId) => {
    // For round 1, we need to copy from round 0 (Opening Round)
    // For all other rounds, copy from localRound - 1
    const previousRound = localRound <= 1 ? 0 : localRound - 1;
    
    try {
      
      setLoadingLocal(true);
      setErrorLocal(null);
      
      // Fetch the previous round data - use round 0 for Opening Round
      const prevRoundRes = await fetch(`/api/team-selection?round=${previousRound}`);
      
      if (!prevRoundRes.ok) {
        throw new Error(`Failed to fetch round ${previousRound} data`);
      }

      const prevRoundData = await prevRoundRes.json();
      
      
      if (!prevRoundData[userId]) {
        setErrorLocal(`No team found for round ${previousRound}`);
        setLoadingLocal(false);
        return;
      }

      // Create new EditedTeams object with previous round data
      const newEditedTeams = { ...editedTeams };
      
      if (!newEditedTeams[userId]) {
        newEditedTeams[userId] = {};
      }
      
      // Copy all positions from the previous round
      Object.entries(prevRoundData[userId]).forEach(([position, data]) => {
        newEditedTeams[userId][position] = {
          player_name: data.player_name,
          position: position,
          ...(data.backup_position && { backup_position: data.backup_position }),
          last_updated: new Date().toISOString()
        };
      });
      
      // Mark all positions as changed
      const newChangedPositions = { ...changedPositions };
      if (!newChangedPositions[userId]) {
        newChangedPositions[userId] = {};
      }
      
      Object.keys(prevRoundData[userId]).forEach(position => {
        newChangedPositions[userId][position] = true;
      });
      
      // Important: Update state in the right order
      
      setEditedTeams(newEditedTeams);
      setChangedPositions(newChangedPositions);
      
      // Force isEditing to true to update UI
      setIsEditing(true);
      
    } catch (err) {
      console.error(`Error copying from round ${previousRound}:`, err);
      setErrorLocal(`Failed to copy team: ${err.message}`);
    } finally {
      setLoadingLocal(false);
    }
  }, [localRound, editedTeams, changedPositions]);

  // Save team selections
// Update the saveTeamSelections function in src/app/hooks/useTeamSelection.js

// Save team selections
const saveTeamSelections = useCallback(async () => {
  // Allow admin to save even if round is locked
  const firstUserId = Object.keys(changedPositions)[0]; // Get the first user being edited
  
  // Check if it's locked AND the user is not admin
  if (isRoundLocked(localRound) && firstUserId !== 'admin') {
    console.log("Current round is locked and user is not admin, can't save changes");
    return false;
  }
  
  const changedTeamSelection = {};
  Object.entries(changedPositions).forEach(([userId, positions]) => {
    if (Object.keys(positions).length > 0) {
      changedTeamSelection[userId] = {};
      Object.keys(positions).forEach(position => {
        if (editedTeams[userId] && editedTeams[userId][position]) {
          changedTeamSelection[userId][position] = editedTeams[userId][position];
        }
      });
    }
  });

  // Don't send empty updates
  if (Object.keys(changedTeamSelection).length === 0) {
    return true;
  }

  try {
    
    
    const response = await fetch('/api/team-selection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        year: CURRENT_YEAR,
        round: parseInt(localRound),
        team_selection: changedTeamSelection
      })
    });

    if (!response.ok) throw new Error('Failed to save team selections');
    
    setTeams(editedTeams);
    setIsEditing(false);
    setChangedPositions({});
    return true;
  } catch (err) {
    console.error('Error saving team selections:', err);
    setError('Failed to save changes');
    return false;
  }
}, [localRound, isRoundLocked, changedPositions, editedTeams]);
  // Cancel editing and revert changes
  const cancelEditing = useCallback(() => {
    setEditedTeams(teams);
    setIsEditing(false);
    setChangedPositions({});
  }, [teams]);

  // Start editing
  const startEditing = useCallback(() => {
    // Allow admin to edit even if round is locked
    if (!isRoundLocked(localRound) || currentRound !== localRound) {
      setIsEditing(true);
    }
  }, [localRound, currentRound, isRoundLocked]);

  // Clear error message
  const clearError = useCallback(() => {
    setErrorLocal(null);
  }, []);

  return {
    // State
    teams: isEditing ? editedTeams : teams,
    squads,
    isEditing,
    loading: loadingLocal,
    error: errorLocal,
    localRound,
    isRoundLocked: isRoundLocked(localRound),
    
    // Actions
    handleRoundChange,
    handlePlayerChange,
    handleBackupPositionChange,
    saveTeamSelections,
    cancelEditing,
    startEditing,
    copyFromPreviousRound,
    clearError
  };
}
'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const retryCountRef = useRef(0);
  const squadsFetchedRef = useRef(false);

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
        console.warn('Squad fetch response not OK:', response.status);
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
      // Ensure the round is a valid number
      const formattedRound = parseInt(round, 10);
      if (isNaN(formattedRound)) {
        console.error(`Invalid round number: ${round}`);
        return {};
      }
      
      console.log(`Fetching team selections for round: ${formattedRound}`);
      
      // Clear error before making request
      setErrorLocal(null);
      
      const response = await fetch(`/api/team-selection?round=${formattedRound}`);
      
      if (!response.ok) {
        console.warn(`Team selection fetch response not OK: ${response.status}`);
        return {};
      }
      
      const data = await response.json();
      console.log(`Team selection data for round ${formattedRound}:`, data);
      
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
  const isRoundLocked = useCallback((roundNumber) => {
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
        if (retryCountRef.current > 3) {
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

        console.log(`Loading team selection data for round ${localRound}`);

        // Load team selections
        const teamsData = await fetchTeamSelections(localRound);

        // Only update state if component is still mounted
        if (!isMounted) return;

        if (teamsData && Object.keys(teamsData).length > 0) {
          console.log(`Loaded team data for round ${localRound}`);
          setTeams(teamsData);
          setEditedTeams(teamsData);
        } else {
          // Set empty defaults if no data returned
          console.log(`No team data found for round ${localRound}, setting empty defaults`);
          setTeams({});
          setEditedTeams({});
        }

        // Load squads if we don't have them yet
        if (!squadsFetchedRef.current) {
          squadsFetchedRef.current = true;
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
          retryCountRef.current += 1;
          setTimeout(() => {
            if (isMounted) loadData();
          }, 1000);
        }
      }
    };

    loadData();

    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [localRound, fetchSquads, fetchTeamSelections]);

  // Reset refs when local round changes
  useEffect(() => {
    retryCountRef.current = 0;
    squadsFetchedRef.current = false;
  }, [localRound]);

  // Handle local round change
  const handleRoundChange = useCallback((newRound) => {
    console.log(`Changing local round to ${newRound}`);
    setLocalRound(newRound);
    // Reset editing state when changing rounds
    setIsEditing(false);
    
    // Also reset any changes
    setChangedPositions({});
  }, []);

  // Handle player selection change
  const handlePlayerChange = useCallback((userId, position, newPlayerName) => {
    console.log(`Updating player for ${userId}, position ${position} to ${newPlayerName}`);
    
    if (isRoundLocked(localRound) && userId !== 'admin') {
      console.log("Round is locked, ignoring player change");
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
    console.log(`Updating backup position for ${userId}, position ${position} to ${newPosition}`);
    
    if (isRoundLocked(localRound) && userId !== 'admin') {
      console.log("Round is locked, ignoring backup position change");
      return;
    }
    
    setEditedTeams(prev => {
      const newTeams = JSON.parse(JSON.stringify(prev)); // Deep clone
      if (!newTeams[userId]) newTeams[userId] = {};
      if (!newTeams[userId][position]) {
        console.log(`Position ${position} doesn't exist yet for user ${userId}`);
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
      console.log(`Attempting to copy from round ${previousRound} to round ${localRound} for user ${userId}`);
      setLoadingLocal(true);
      setErrorLocal(null);
      
      // Fetch the previous round data - use round 0 for Opening Round
      const prevRoundRes = await fetch(`/api/team-selection?round=${previousRound}`);
      
      if (!prevRoundRes.ok) {
        throw new Error(`Failed to fetch round ${previousRound} data`);
      }

      const prevRoundData = await prevRoundRes.json();
      console.log(`Previous round (${previousRound}) data:`, prevRoundData);
      
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
      console.log("Setting new edited teams state:", newEditedTeams[userId]);
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
    console.log(`Saving team selections for round ${localRound}:`, changedTeamSelection);
    
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
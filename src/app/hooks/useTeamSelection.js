'use client'

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR } from '@/app/lib/constants';

export default function useTeamSelection() {
  const { 
    currentRound, 
    roundInfo
  } = useAppContext();
  
  const [teams, setTeams] = useState({});
  const [editedTeams, setEditedTeams] = useState({});
  const [squads, setSquads] = useState({});
  const [changedPositions, setChangedPositions] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [errorLocal, setErrorLocal] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

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
      // Add a small delay for API stability
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const response = await fetch(`/api/team-selection?round=${round}`);
      
      if (!response.ok) {
        console.warn('Team selection fetch response not OK:', response.status);
        return {};
      }
      
      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Error fetching team selections:', err);
      // Return empty object as fallback
      return {};
    }
  }, []);

  // Load data when round changes
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
        
        setLoadingLocal(true);
        setErrorLocal(null);
        
        // Load team selections
        const teamsData = await fetchTeamSelections(currentRound);
        
        // Only update state if component is still mounted
        if (!isMounted) return;
        
        if (teamsData && Object.keys(teamsData).length > 0) {
          setTeams(teamsData);
          setEditedTeams(teamsData);
        } else {
          // Set empty defaults if no data returned
          setTeams({});
          setEditedTeams({});
          
          // We retrieved empty data, but no error - this is normal for new rounds
          if (retryCount === 0) {
            console.log('No team selection data for round', currentRound);
          }
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
          setErrorLocal('Failed to load team data');
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
  }, [currentRound, fetchSquads, fetchTeamSelections, retryCount]);

  // Reset retry count when round changes
  useEffect(() => {
    setRetryCount(0);
  }, [currentRound]);

  // Handle player selection change
  const handlePlayerChange = useCallback((userId, position, newPlayerName) => {
    if (roundInfo?.isLocked) return;
    
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

    setChangedPositions(prev => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || {}),
        [position]: true
      }
    }));
  }, [roundInfo, squads]);

  // Handle backup position change for bench players
  const handleBackupPositionChange = useCallback((userId, position, newPosition) => {
    if (roundInfo?.isLocked) return;
    
    setEditedTeams(prev => {
      const newTeams = {...prev};
      if (!newTeams[userId]) newTeams[userId] = {};
      if (!newTeams[userId][position]) return newTeams;

      newTeams[userId][position] = {
        ...newTeams[userId][position],
        backup_position: newPosition
      };
      
      return newTeams;
    });

    setChangedPositions(prev => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || {}),
        [position]: true
      }
    }));
  }, [roundInfo]);

  // Save team selections
  const saveTeamSelections = useCallback(async () => {
    if (roundInfo?.isLocked) return false;
    
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
          round: parseInt(currentRound),
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
      setErrorLocal('Failed to save changes');
      return false;
    }
  }, [roundInfo, changedPositions, editedTeams, currentRound]);

  // Cancel editing and revert changes
  const cancelEditing = useCallback(() => {
    setEditedTeams(teams);
    setIsEditing(false);
    setChangedPositions({});
  }, [teams]);

  // Start editing
  const startEditing = useCallback(() => {
    if (!roundInfo?.isLocked) {
      setIsEditing(true);
    }
  }, [roundInfo]);

  // Copy from previous round
  const copyFromPreviousRound = useCallback(async (userId) => {
    if (currentRound <= 1 || roundInfo?.isLocked) return;
    
    try {
      const prevRoundRes = await fetch(`/api/team-selection?round=${currentRound - 1}`);
      
      if (!prevRoundRes.ok) {
        throw new Error('Failed to fetch previous round data');
      }

      const prevRoundData = await prevRoundRes.json();
      
      if (!prevRoundData[userId]) {
        setErrorLocal('No data found for previous round');
        return;
      }

      setEditedTeams(prev => {
        const newTeamSelection = { ...prev };
        newTeamSelection[userId] = Object.entries(prevRoundData[userId]).reduce((acc, [position, data]) => {
          acc[position] = {
            ...data,
            last_updated: new Date().toISOString()
          };
          return acc;
        }, {});
        return newTeamSelection;
      });

      setChangedPositions(prev => {
        const newChanges = { ...prev };
        if (!newChanges[userId]) newChanges[userId] = {};
        
        Object.keys(prevRoundData[userId]).forEach(position => {
          newChanges[userId][position] = true;
        });
        
        return newChanges;
      });
    } catch (err) {
      console.error('Error copying from previous round:', err);
      setErrorLocal('Failed to copy from previous round');
    }
  }, [currentRound, roundInfo]);

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
    
    // Actions
    handlePlayerChange,
    handleBackupPositionChange,
    saveTeamSelections,
    cancelEditing,
    startEditing,
    copyFromPreviousRound,
    clearError
  };
}
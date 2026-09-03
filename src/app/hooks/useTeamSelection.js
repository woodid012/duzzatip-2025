'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR } from '@/app/lib/constants';
import {
  clubGameStart,
  firstGameStart,
  isRoundFullyLocked,
  isRoundPartiallyLocked as isRoundPartiallyLockedFn,
  nextLockoutTime,
  positionLockReason as positionLockReasonFn,
} from '@/app/lib/rollingLockout';

export default function useTeamSelection() {
  const {
    currentRound,
    roundInfo,
    fixtures,
    selectedYear,
    isPastYear,
  } = useAppContext();
  
  // Local round state - initialized from global current round but can be changed independently
  const [localRound, setLocalRound] = useState(null);
  const [userChangedRound, setUserChangedRound] = useState(false);

  const [teams, setTeams] = useState({});
  const [editedTeams, setEditedTeams] = useState({});
  const [squads, setSquads] = useState({});
  const [playerScores, setPlayerScores] = useState({});
  const [changedPositions, setChangedPositions] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [errorLocal, setErrorLocal] = useState(null);
  const retryCountRef = useRef(0);
  const squadsFetchedRef = useRef(false);

  // Sync local round when currentRound loads
  useEffect(() => {
    if (currentRound !== null && !userChangedRound) {
      setLocalRound(currentRound);
    }
  }, [currentRound]);

  // Create stable fetch functions using useCallback
  const fetchSquads = useCallback(async () => {
    try {
      const response = await fetch(`/api/squads?year=${selectedYear}`);

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
  }, [selectedYear]);

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
      
      const response = await fetch(`/api/team-selection?round=${formattedRound}&year=${selectedYear}`);
      
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
  }, [selectedYear]);

  // Rolling lockout: a round is only *fully* locked once every game in it has
  // started. Before that, individual picks lock as their own game commences —
  // see isPositionLocked below.
  const isRoundLocked = useCallback((roundNumber) => {
    if (roundNumber > currentRound) return false;
    return isRoundFullyLocked(fixtures, roundNumber);
  }, [currentRound, fixtures]);

  // At least one game has started but not all — the rolling window, where some
  // positions are locked and the rest are still up for grabs.
  const isRoundPartiallyLocked = useCallback((roundNumber) => {
    return isRoundPartiallyLockedFn(fixtures, roundNumber);
  }, [fixtures]);

  // Resolve a player to their club code from the squad, so the shared lockout
  // rules can find the game they're playing in.
  const clubOfFor = useCallback((userId) => (playerName) => {
    if (!playerName || !userId) return null;
    const userSquad = squads[userId]?.players;
    if (!userSquad) return null;
    return userSquad.find(p => p.name === playerName)?.team ?? null;
  }, [squads]);

  // Get the game start time for a player in a given round.
  // Returns the DateUtc of their club's game, or null if bye/not found.
  const getPlayerGameTime = useCallback((playerName, userId, roundNumber) => {
    return clubGameStart(fixtures, roundNumber, clubOfFor(userId)(playerName));
  }, [fixtures, clubOfFor]);

  // Why this position is locked, or null if it's still editable. The rules live
  // in lib/rollingLockout so the API enforces exactly what the UI shows.
  const getPositionLockReason = useCallback((userId, position, roundNumber) => {
    const rnd = roundNumber ?? localRound;
    if (rnd === null || rnd === undefined) return null;
    // Future rounds are never locked
    if (rnd > currentRound) return null;
    const currentTeams = isEditing ? editedTeams : teams;
    return positionLockReasonFn(currentTeams[userId] || {}, position, {
      fixtures,
      round: rnd,
      clubOf: clubOfFor(userId),
    });
  }, [localRound, currentRound, teams, editedTeams, isEditing, clubOfFor, fixtures]);

  const isPositionLocked = useCallback((userId, position, roundNumber) => {
    return getPositionLockReason(userId, position, roundNumber) !== null;
  }, [getPositionLockReason]);

  // Check if a player's game has started (for filtering dropdowns) — you can't
  // pick someone you've already watched play.
  const isPlayerGameStarted = useCallback((playerName, userId, roundNumber) => {
    const rnd = roundNumber ?? localRound;
    const gameTime = getPlayerGameTime(playerName, userId, rnd);
    if (!gameTime) return false;
    return new Date() >= gameTime;
  }, [localRound, getPlayerGameTime]);

  // Get the next upcoming lockout time for a round (next game that hasn't started yet).
  const getNextLockoutTime = useCallback((roundNumber) => {
    return nextLockoutTime(fixtures, roundNumber);
  }, [fixtures]);

  // True only for Opening Round (Round 0) when games have started — that round is genuinely for fun.
  const isForFunOnly = useCallback((roundNumber) => {
    return roundNumber === 0 && roundNumber === currentRound && !!roundInfo.isLocked;
  }, [roundInfo.isLocked, currentRound]);

  // True only when a scoring round (1+) is fully locked (all games started) — with rolling
  // lockout, editing mid-round for unlocked positions is normal, not "late".
  const isLateSubmission = useCallback((roundNumber) => {
    return roundNumber > 0 && roundNumber === currentRound && isRoundLocked(roundNumber);
  }, [currentRound, isRoundLocked]);

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

        // For any bench player missing a backup position, default to last round's value
        if (teamsData && Object.keys(teamsData).length > 0 && localRound > 0) {
          const hasMissingBackup = Object.values(teamsData).some(
            userTeam => userTeam?.['Bench']?.player_name && !userTeam['Bench'].backup_position
          );
          if (hasMissingBackup) {
            try {
              const prevRound = localRound - 1;
              const prevRes = await fetch(`/api/team-selection?round=${prevRound}&year=${selectedYear}`);
              if (prevRes.ok) {
                const prevData = await prevRes.json();
                Object.entries(teamsData).forEach(([userId, userTeam]) => {
                  if (userTeam?.['Bench']?.player_name && !userTeam['Bench'].backup_position) {
                    const prevBackup = prevData[userId]?.['Bench']?.backup_position;
                    if (prevBackup) {
                      teamsData[userId]['Bench'] = {
                        ...teamsData[userId]['Bench'],
                        backup_position: prevBackup
                      };
                    }
                  }
                });
              }
            } catch (err) {
              console.warn('Could not fetch previous round for backup position defaults:', err);
            }
          }
        }

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

  // Reset refs when local round or year changes
  useEffect(() => {
    retryCountRef.current = 0;
    squadsFetchedRef.current = false;
  }, [localRound, selectedYear]);

  // Handle local round change
  const handleRoundChange = useCallback((newRound) => {
    console.log(`Changing local round to ${newRound}`);
    setLocalRound(newRound);
    setUserChangedRound(true);
    // Reset editing state when changing rounds
    setIsEditing(false);
    
    // Also reset any changes
    setChangedPositions({});
  }, []);

  // Handle player selection change
  const handlePlayerChange = useCallback((userId, position, newPlayerName) => {
    console.log(`Updating player for ${userId}, position ${position} to ${newPlayerName}`);
    
    if (isPositionLocked(userId, position) && userId !== 'admin') {
      console.log(`Position ${position} is locked (game started), ignoring player change`);
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
  }, [localRound, isPositionLocked, isEditing]);

  // Handle backup position change for bench players
  const handleBackupPositionChange = useCallback((userId, position, newPosition) => {
    console.log(`Updating backup position for ${userId}, position ${position} to ${newPosition}`);

    // Bench backup-position (coverage choice) locks at first game kickoff — can't change
    // which position the bench covers once the round has started.
    if (position === 'Bench' && userId !== 'admin') {
      const firstGame = firstGameStart(fixtures, localRound);
      if (firstGame && new Date() >= firstGame) {
        console.log('Bench backup position locked (first game started)');
        return;
      }
    }

    if (isPositionLocked(userId, position) && userId !== 'admin') {
      console.log(`Position ${position} is locked (game started), ignoring backup position change`);
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
  }, [localRound, isPositionLocked, isEditing]);

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
      const prevRoundRes = await fetch(`/api/team-selection?round=${previousRound}&year=${selectedYear}`);
      
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
  const changedTeamSelection = {};
  Object.entries(changedPositions).forEach(([userId, positions]) => {
    if (Object.keys(positions).length > 0) {
      changedTeamSelection[userId] = {};
      Object.keys(positions).forEach(position => {
        // Skip locked positions (unless admin)
        if (userId !== 'admin' && isPositionLocked(userId, position)) {
          console.log(`Skipping locked position ${position} for user ${userId}`);
          return;
        }
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

    if (!response.ok) {
      // 409 is the rolling lockout refusing picks whose games have started.
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error || 'Failed to save team selections');
    }

    setTeams(editedTeams);
    setIsEditing(false);
    setChangedPositions({});
    return true;
  } catch (err) {
    console.error('Error saving team selections:', err);
    setErrorLocal(err.message || 'Failed to save changes');
    return false;
  }
}, [localRound, isPositionLocked, changedPositions, editedTeams]);
  // Cancel editing and revert changes
  const cancelEditing = useCallback(() => {
    setEditedTeams(teams);
    setIsEditing(false);
    setChangedPositions({});
  }, [teams]);

  // Start editing — allowed unless the round is fully locked (all games started)
  const startEditing = useCallback(() => {
    if (!isRoundLocked(localRound) || currentRound !== localRound) {
      setIsEditing(true);
    }
  }, [localRound, currentRound, isRoundLocked]);

  // Fetch player scores from consolidated results once any game in the round has started.
  // Builds a map { userId: { playerName: score } } used to display scores on locked positions.
  useEffect(() => {
    if (localRound === null || localRound === undefined) return;
    if (currentRound !== null && localRound > currentRound) return;
    const firstGame = firstGameStart(fixtures, localRound);
    if (!firstGame || new Date() < firstGame) return; // round hasn't started

    let cancelled = false;
    fetch(`/api/consolidated-round-results?round=${localRound}&year=${selectedYear}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.results) return;
        const scores = {};
        Object.entries(data.results).forEach(([userId, result]) => {
          scores[userId] = {};
          (result.positions || []).forEach(pos => {
            const name = pos.originalPlayerName || pos.playerName;
            if (name) scores[userId][name] = pos.originalScore ?? pos.score ?? 0;
          });
        });
        setPlayerScores(scores);
      })
      .catch(() => {}); // supplementary — silent fail
    return () => { cancelled = true; };
  }, [localRound, currentRound, fixtures, selectedYear]);

  // Clear error message
  const clearError = useCallback(() => {
    setErrorLocal(null);
  }, []);

  return {
    // State
    teams: isEditing ? editedTeams : teams,
    squads,
    playerScores,
    isEditing,
    loading: loadingLocal,
    error: errorLocal,
    localRound,
    isRoundLocked: isRoundLocked(localRound),
    isRoundPartiallyLocked: isRoundPartiallyLocked(localRound),
    isForFunOnly: isForFunOnly(localRound),
    isLateSubmission: isLateSubmission(localRound),
    isPastYear,

    // Per-game locking
    isPositionLocked,
    getPositionLockReason,
    isPlayerGameStarted,
    getNextLockoutTime: () => getNextLockoutTime(localRound),

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
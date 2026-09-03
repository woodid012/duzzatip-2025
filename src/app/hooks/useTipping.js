'use client'

import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR } from '@/app/lib/constants';
import {
  isMatchLocked as isMatchLockedFn,
  isRoundFullyLocked,
  isRoundPartiallyLocked as isRoundPartiallyLockedFn,
  nextLockoutTime,
  startedMatchNumbers,
} from '@/app/lib/rollingLockout';

export default function useTipping(initialUserId = '', { isAdmin = false } = {}) {
  const { currentRound, roundInfo, fixtures, changeRound, selectedYear, isPastYear } = useAppContext();

  // Use refs to maintain state between renders
  const isInitializedRef = useRef(false);

  // Local round state - initialized from global current round but can be changed independently
  const [localRound, setLocalRound] = useState(null);
  const [userChangedRound, setUserChangedRound] = useState(false);

  // State for user and tips
  const [selectedUserId, setSelectedUserId] = useState(initialUserId);
  const [tips, setTips] = useState({});
  const [editedTips, setEditedTips] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [errorLocal, setErrorLocal] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [lastEditedTime, setLastEditedTime] = useState(null);

  // Round fixtures
  const [roundFixtures, setRoundFixtures] = useState([]);

  // Track if data has been loaded
  const [dataLoaded, setDataLoaded] = useState(false);

  // Sync local round when currentRound loads
  useEffect(() => {
    if (currentRound !== null && !userChangedRound) {
      setLocalRound(currentRound);
    }
  }, [currentRound]);

  // Update selectedUserId when initialUserId changes (from context)
  // But only for non-admin users - admin manages team selection locally
  useEffect(() => {
    if (initialUserId && initialUserId !== 'admin' && initialUserId !== selectedUserId) {
      console.log(`useTipping: Updating selectedUserId from ${selectedUserId} to ${initialUserId}`);
      setSelectedUserId(initialUserId);
      // Reset state when user changes
      setIsEditing(false);
      setDataLoaded(false);
      setLastEditedTime(null);
      isInitializedRef.current = false;
    } else if (initialUserId === 'admin' && !selectedUserId) {
      // If admin is selected but no local user is set, initialize as empty
      console.log('useTipping: Admin mode initialized, no specific team selected');
      setSelectedUserId('');
    }
  }, [initialUserId, selectedUserId]);

  // Rolling lockout: each match's tip (and its dead cert) locks the moment that
  // match commences. Matches later in the round stay editable until their own
  // bounce, so a round is only fully locked once every game has started.
  const isMatchLocked = (matchNumber, round = localRound) => {
    if (isAdmin) return false;
    if (round > currentRound) return false;
    return isMatchLockedFn(fixtures, round, matchNumber);
  };

  const isRoundLocked = (round) => {
    if (isAdmin) return false;
    if (round > currentRound) return false;
    return isRoundFullyLocked(fixtures, round);
  };

  // Some games have started, others haven't — tips are partly locked.
  const isRoundPartiallyLocked = (round) => {
    if (isAdmin) return false;
    if (round > currentRound) return false;
    return isRoundPartiallyLockedFn(fixtures, round);
  };

  // The next bounce that will lock more tips, or null once they're all locked.
  const getNextLockoutTime = (round) => nextLockoutTime(fixtures, round);

  // True when every game in the round has started and the user never got tips
  // in before the first bounce — i.e. they missed the round entirely.
  const isLateSubmission = (round) => {
    if (isAdmin) return false;
    if (round !== currentRound) return false;
    if (!isRoundFullyLocked(fixtures, round)) return false;
    if (lastEditedTime && roundInfo.lockoutDate) {
      return lastEditedTime >= new Date(roundInfo.lockoutDate);
    }
    return !lastEditedTime;
  };

  // Load fixtures for the selected local round
  useEffect(() => {
    if (fixtures.length > 0 && localRound != null) {
      // Chronological order for display — MatchNumber is assigned before
      // scheduling in later rounds, so it no longer tracks kickoff order.
      const filtered = fixtures
        .filter(fixture => fixture.RoundNumber.toString() === localRound.toString())
        .sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc) || a.MatchNumber - b.MatchNumber);
      setRoundFixtures(filtered);
      console.log(`Loaded ${filtered.length} fixtures for round ${localRound}`);
    }
  }, [fixtures, localRound]);

  // Load tips data when user or local round changes
  useEffect(() => {
    // Skip if no user is selected or if user is admin but no specific team selected
    if (!selectedUserId || selectedUserId === 'admin') {
      setLoadingLocal(false);
      setDataLoaded(true);
      return;
    }
    
    // Don't reload data if editing and the user/round hasn't changed
    if (isEditing && isInitializedRef.current) {
      return;
    }
    
    const loadTips = async () => {
      try {
        setLoadingLocal(true);
        
        console.log(`Loading tips for user ${selectedUserId}, round ${localRound}`);
        
        const url = `/api/tipping-data?round=${localRound}&userId=${selectedUserId}&year=${selectedYear}`;
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Failed to load tips: ${response.status}`);
        }
        
        const data = await response.json();
        const tipsData = data.tips || {};
        const lastUpdated = data.lastUpdated || null;
        
        // Set last edited time if available
        if (lastUpdated) {
          setLastEditedTime(new Date(lastUpdated));
        }
        
        // If no tips exist for matches, default to home team for each fixture
        const defaultedTips = {};
        if (roundFixtures.length > 0) {
          roundFixtures.forEach(fixture => {
            if (!tipsData[fixture.MatchNumber]) {
              defaultedTips[fixture.MatchNumber] = {
                team: fixture.HomeTeam,
                deadCert: false
              };
            }
          });
        }

        const combinedTips = {
          ...defaultedTips,
          ...tipsData
        };

        console.log("Loaded tips:", combinedTips);
        setTips(combinedTips);
        setEditedTips(combinedTips);
        setDataLoaded(true);
        isInitializedRef.current = true;
        
      } catch (err) {
        console.error('Error loading tips:', err);
        setErrorLocal(err.message);
      } finally {
        setLoadingLocal(false);
      }
    };

    loadTips();
    
    // Cleanup function - make sure to clear isEditing when user/round changes
    return () => {
      if (isEditing) {
        console.log("Cleaning up editing state on user/round change");
        setIsEditing(false);
      }
    };
  }, [localRound, selectedUserId, roundFixtures, selectedYear]);

  // Handle local round change
  const handleRoundChange = (newRound) => {
    console.log(`Changing local round to ${newRound}`);
    setLocalRound(newRound);
    setUserChangedRound(true);
    // Reset editing state when changing rounds
    setIsEditing(false);
    // Reset data loaded state to force reload
    setDataLoaded(false);
    isInitializedRef.current = false;
  };

  // Handle team tip selection
  const handleTipSelect = (matchNumber, team) => {
    console.log(`Setting tip for match ${matchNumber} to ${team} (isEditing: ${isEditing})`);

    if (!isEditing || isMatchLocked(matchNumber)) {
      console.log("Can't edit - this match has already commenced");
      return;
    }

    // Keep everything in editedTips immutable
    setEditedTips(prev => {
      const newTips = { ...prev };
      
      // Check if we're changing the team (not just re-selecting the same team)
      const currentTeam = newTips[matchNumber]?.team;
      const isChangingTeam = currentTeam && currentTeam !== team;
      
      // If we're changing teams, reset the dead cert status
      const deadCert = isChangingTeam ? false : newTips[matchNumber]?.deadCert;
      
      newTips[matchNumber] = {
        ...newTips[matchNumber],
        team,
        deadCert,
        isDefault: false // an explicit pick is a real tip, not an auto-default
      };
      return newTips;
    });
  };

  // Toggle dead cert status
  const handleDeadCertToggle = (matchNumber) => {
    console.log(`Toggling dead cert for match ${matchNumber} (isEditing: ${isEditing})`);

    if (!isEditing || isMatchLocked(matchNumber)) {
      console.log("Can't edit - this match has already commenced");
      return;
    }

    setEditedTips(prev => {
      const newTips = { ...prev };
      newTips[matchNumber] = {
        ...newTips[matchNumber],
        deadCert: !newTips[matchNumber]?.deadCert
      };
      return newTips;
    });
  };

  // Save tips
  const saveTips = async () => {
    if (!selectedUserId || isRoundLocked(localRound)) {
      console.log("Can't save - no user selected or every game has started");
      return false;
    }

    // Rolling lockout: only send tips for matches that haven't bounced yet. The
    // API refuses locked matches anyway, but there's no point shipping picks we
    // know it will drop — and it keeps the saved-vs-shown state honest.
    const locked = isAdmin ? new Set() : startedMatchNumbers(fixtures, localRound);
    const tipsToSave = Object.fromEntries(
      Object.entries(editedTips).filter(([matchNumber]) => !locked.has(Number(matchNumber)))
    );
    console.log("Saving tips...", tipsToSave);

    try {
      setErrorLocal(null);

      const response = await fetch('/api/tipping-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round: localRound,
          userId: selectedUserId,
          tips: tipsToSave,
          lastUpdated: new Date().toISOString()
        })
      });

      if (!response.ok) throw new Error('Failed to save tips');
      
      // Update the base tips state to reflect what was actually saved — locked
      // matches keep whatever was already committed for them.
      console.log("Tips saved successfully");
      setTips(prev => ({ ...prev, ...tipsToSave }));
      setEditedTips(prev => ({ ...prev, ...tipsToSave }));
      setIsEditing(false);
      
      // Set last edited time to current time
      setLastEditedTime(new Date());
      
      setSuccessMessage('Tips saved successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      return true;
    } catch (err) {
      console.error('Error saving tips:', err);
      setErrorLocal('Failed to save tips');
      setTimeout(() => setErrorLocal(null), 3000);
      return false;
    }
  };

  // Cancel editing
  const cancelEditing = () => {
    console.log("Canceling edits");
    setEditedTips({ ...tips });
    setIsEditing(false);
  };

  // Start editing
  const startEditing = () => {
    console.log("Starting editing, isLocked:", isRoundLocked(localRound), "isAdmin:", isAdmin, "userId:", selectedUserId);

    // Admin can always edit; everyone else while at least one game is still to come
    if (!isRoundLocked(localRound) && selectedUserId) {
      console.log("Setting isEditing to true");
      // Ensure we're working with the latest data
      setEditedTips({ ...tips });
      setIsEditing(true);
    }
  };

  // Change selected user - this is the key function for admin
  const changeUser = (userId) => {
    console.log(`Changing user from ${selectedUserId} to ${userId}`);
    if (userId !== selectedUserId) {
      setSelectedUserId(userId);
      setIsEditing(false);
      setDataLoaded(false);
      setLastEditedTime(null);
      isInitializedRef.current = false;
      
      // Clear tips when changing user
      setTips({});
      setEditedTips({});
    }
  };

  // Format round name nicely
  const formatRoundName = (round) => {
    if (round === 0) return "Opening Round";
    return `Round ${round}`;
  };

  return {
    // State
    selectedUserId,
    tips: isEditing ? editedTips : tips,
    roundFixtures,
    isEditing,
    loading: loadingLocal,
    error: errorLocal,
    successMessage,
    dataLoaded,
    lastEditedTime,
    localRound,
    isRoundLocked: isRoundLocked(localRound),
    isRoundPartiallyLocked: isRoundPartiallyLocked(localRound),
    isLateSubmission: isLateSubmission(localRound),
    isPastYear,

    // Rolling lockout
    isMatchLocked,
    getNextLockoutTime: () => getNextLockoutTime(localRound),

    // Display helpers
    formatRoundName,
    
    // Actions
    handleRoundChange,
    handleTipSelect,
    handleDeadCertToggle,
    saveTips,
    cancelEditing,
    startEditing,
    changeUser
  };
}
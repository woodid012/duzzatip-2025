'use client'

import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR } from '@/app/lib/constants';

export default function useTipping(initialUserId = '') {
  const { currentRound, roundInfo, fixtures, changeRound } = useAppContext();
  
  // Use refs to maintain state between renders
  const isInitializedRef = useRef(false);
  
  // Local round state - initialized from global current round but can be changed independently
  const [localRound, setLocalRound] = useState(currentRound);
  
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

  // Initialize local round from global current round on first render
  useEffect(() => {
    if (localRound === undefined && currentRound !== undefined) {
      setLocalRound(currentRound);
    }
  }, [currentRound, localRound]);

  // Determine if round is locked for editing - MODIFIED to ensure past rounds stay locked
  const isRoundLocked = (round) => {
    // Any round before the current round is always locked (historical round)
    if (round < currentRound) {
      return true;
    }
    
    // For opening round (0), if it's locked, it stays locked
    if (round === 0 && roundInfo.isLocked) {
      return true;
    }
    
    // If we're viewing the current global round and it's locked
    if (roundInfo.isLocked && round === currentRound) {
      return true;
    }
    
    // If this is a future round, check if its lockout time has passed
    if (round > currentRound && roundInfo.nextRoundInfo) {
      const now = new Date();
      const lockoutDate = new Date(roundInfo.nextRoundInfo.lockoutDate);
      
      // If the future round's lockout time has passed
      if (now > lockoutDate) {
        return true;
      }
    }
    
    // Otherwise this specific round is not locked
    return false;
  }

  // Load fixtures for the selected local round
  useEffect(() => {
    if (fixtures.length > 0 && localRound !== undefined) {
      const filtered = fixtures.filter(
        fixture => fixture.RoundNumber.toString() === localRound.toString()
      );
      setRoundFixtures(filtered);
      console.log(`Loaded ${filtered.length} fixtures for round ${localRound}`);
    }
  }, [fixtures, localRound]);

  // Load tips data when user or local round changes
  useEffect(() => {
    // Skip if no user is selected
    if (!selectedUserId) {
      setLoadingLocal(false);
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
        
        const url = `/api/tipping-data?round=${localRound}&userId=${selectedUserId}`;
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
  }, [localRound, selectedUserId, roundFixtures]);

  // Handle local round change
  const handleRoundChange = (newRound) => {
    console.log(`Changing local round to ${newRound}`);
    setLocalRound(newRound);
    // Reset editing state when changing rounds
    setIsEditing(false);
  };

  // Handle team tip selection
  const handleTipSelect = (matchNumber, team) => {
    console.log(`Setting tip for match ${matchNumber} to ${team} (isEditing: ${isEditing})`);
    if (!isEditing || isRoundLocked(localRound)) {
      console.log("Can't edit - editing is locked");
      return;
    }
    
    // Keep everything in editedTips immutable
    setEditedTips(prev => {
      const newTips = { ...prev };
      newTips[matchNumber] = {
        ...newTips[matchNumber],
        team
      };
      return newTips;
    });
  };

  // Toggle dead cert status
  const handleDeadCertToggle = (matchNumber) => {
    console.log(`Toggling dead cert for match ${matchNumber} (isEditing: ${isEditing})`);
    if (!isEditing || isRoundLocked(localRound)) {
      console.log("Can't edit - editing is locked");
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
      console.log("Can't save - no user selected or round is locked");
      return false;
    }
    
    console.log("Saving tips...", editedTips);
    
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
          tips: editedTips,
          lastUpdated: new Date().toISOString()
        })
      });

      if (!response.ok) throw new Error('Failed to save tips');
      
      // Update the base tips state to match edited tips
      console.log("Tips saved successfully");
      setTips({ ...editedTips });
      setIsEditing(false);
      
      // Set last edited time to current time
      const now = new Date();
      setLastEditedTime(now);
      
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
    console.log("Starting editing, isLocked:", isRoundLocked(localRound), "userId:", selectedUserId);
    if (!isRoundLocked(localRound) && selectedUserId) {
      console.log("Setting isEditing to true");
      // Ensure we're working with the latest data
      setEditedTips({ ...tips });
      setIsEditing(true);
    }
  };

  // Change selected user
  const changeUser = (userId) => {
    console.log(`Changing user from ${selectedUserId} to ${userId}`);
    if (userId !== selectedUserId) {
      setSelectedUserId(userId);
      setIsEditing(false);
      setDataLoaded(false);
      setLastEditedTime(null);
      isInitializedRef.current = false;
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
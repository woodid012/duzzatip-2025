'use client'

import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR } from '@/app/lib/constants';

export default function useTipping(initialUserId = '') {
  const { currentRound, roundInfo, fixtures } = useAppContext();
  
  // Use refs to maintain state between renders
  const isInitializedRef = useRef(false);
  
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

  // Load fixtures for the current round
  useEffect(() => {
    if (fixtures.length > 0) {
      const filtered = fixtures.filter(
        fixture => fixture.RoundNumber.toString() === currentRound.toString()
      );
      setRoundFixtures(filtered);
    }
  }, [fixtures, currentRound]);

  // Load tips data when user or round changes
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
        console.log(`Loading tips for user ${selectedUserId}, round ${currentRound}`);
        
        const url = `/api/tipping-data?round=${currentRound}&userId=${selectedUserId}`;
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
  }, [currentRound, selectedUserId, roundFixtures]);

  // Handle team tip selection
  const handleTipSelect = (matchNumber, team) => {
    console.log(`Setting tip for match ${matchNumber} to ${team} (isEditing: ${isEditing})`);
    if (!isEditing || roundInfo.isLocked) {
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
    if (!isEditing || roundInfo.isLocked) {
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
    if (!selectedUserId || roundInfo.isLocked) {
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
          round: currentRound,
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
    console.log("Starting editing, isLocked:", roundInfo.isLocked, "userId:", selectedUserId);
    if (!roundInfo.isLocked && selectedUserId) {
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
    
    // Actions
    handleTipSelect,
    handleDeadCertToggle,
    saveTips,
    cancelEditing,
    startEditing,
    changeUser
  };
}
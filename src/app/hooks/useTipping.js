'use client'

import { useState, useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR } from '@/app/lib/constants';

export default function useTipping(initialUserId = '') {
  const { currentRound, roundInfo, fixtures } = useAppContext();
  
  const [selectedUserId, setSelectedUserId] = useState(initialUserId);
  const [tips, setTips] = useState({});
  const [editedTips, setEditedTips] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [errorLocal, setErrorLocal] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Round fixtures
  const [roundFixtures, setRoundFixtures] = useState([]);

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
    const loadTips = async () => {
      if (!selectedUserId) {
        setLoadingLocal(false);
        return;
      }
      
      try {
        setLoadingLocal(true);
        
        const url = `/api/tipping-data?round=${currentRound}&userId=${selectedUserId}`;
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Failed to load tips: ${response.status}`);
        }
        
        const data = await response.json();
        const tipsData = data.tips || {};
        
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

        setTips(combinedTips);
        setEditedTips(combinedTips);
        
        setLoadingLocal(false);
      } catch (err) {
        console.error('Error loading tips:', err);
        setErrorLocal(err.message);
        setLoadingLocal(false);
      }
    };

    loadTips();
  }, [currentRound, selectedUserId, roundFixtures]);

  // Handle team tip selection
  const handleTipSelect = (matchNumber, team) => {
    if (!isEditing || roundInfo.isLocked) return;
    
    setEditedTips(prev => ({
      ...prev,
      [matchNumber]: {
        ...prev[matchNumber],
        team
      }
    }));
  };

  // Toggle dead cert status
  const handleDeadCertToggle = (matchNumber) => {
    if (!isEditing || roundInfo.isLocked) return;

    setEditedTips(prev => ({
      ...prev,
      [matchNumber]: {
        ...prev[matchNumber],
        deadCert: !prev[matchNumber]?.deadCert
      }
    }));
  };

  // Save tips
  const saveTips = async () => {
    if (!selectedUserId || roundInfo.isLocked) return false;
    
    try {
      const response = await fetch('/api/tipping-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round: currentRound,
          userId: selectedUserId,
          tips: editedTips
        })
      });

      if (!response.ok) throw new Error('Failed to save tips');
      
      setTips(editedTips);
      setIsEditing(false);
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
    setEditedTips(tips);
    setIsEditing(false);
  };

  // Start editing
  const startEditing = () => {
    if (!roundInfo.isLocked && selectedUserId) {
      setIsEditing(true);
    }
  };

  // Change selected user
  const changeUser = (userId) => {
    setSelectedUserId(userId);
    setIsEditing(false);
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
    
    // Actions
    handleTipSelect,
    handleDeadCertToggle,
    saveTips,
    cancelEditing,
    startEditing,
    changeUser
  };
}

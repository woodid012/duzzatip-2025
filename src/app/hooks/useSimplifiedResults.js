'use client'

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { calculateFinalsFixtures, isFinalRound } from '@/app/lib/finals_utils';

export default function useSimplifiedResults() {
  const { currentRound, roundInfo, selectedYear } = useAppContext();
  const [displayRound, setDisplayRound] = useState(null);
  const [roundData, setRoundData] = useState(null);
  const [fixtures, setFixtures] = useState([]);
  const [error, setError] = useState(null);

  // Progressive loading states
  const [loadingStage, setLoadingStage] = useState('initializing'); // 'initializing', 'round', 'fixtures', 'results', 'complete'
  const [loadingMessage, setLoadingMessage] = useState('Initializing...');

  // Cache for round data to prevent refetching
  const [roundCache] = useState(new Map());

  // Clear cache when year changes
  useEffect(() => {
    roundCache.clear();
  }, [selectedYear, roundCache]);

  // Initialize round from context
  useEffect(() => {
    if (currentRound !== undefined && displayRound === null) {
      setLoadingStage('round');
      setLoadingMessage('Setting up round...');
      setDisplayRound(currentRound);
    }
  }, [currentRound, displayRound]);

  // Progressive data loading
  const loadRoundData = useCallback(async (round) => {
    if (round === null || round === undefined) return;

    // Check cache first
    if (roundCache.has(round)) {
      const cachedData = roundCache.get(round);
      setRoundData(cachedData.roundData);
      setFixtures(cachedData.fixtures);
      setLoadingStage('complete');
      setLoadingMessage('');
      return;
    }

    try {
      setError(null);

      // Stage 1: Set up round
      setLoadingStage('round');
      setLoadingMessage(`Loading Round ${round} information...`);
      await new Promise(resolve => setTimeout(resolve, 300)); // Brief pause for visual feedback

      // Stage 2: Load fixtures
      setLoadingStage('fixtures');
      setLoadingMessage(`Loading Round ${round} fixtures...`);
      
      let fixturesData = [];
      if (isFinalRound(round)) {
        // For finals rounds, calculate fixtures dynamically
        fixturesData = await calculateFinalsFixtures(round);
      } else {
        // For regular season, use static fixtures
        fixturesData = getFixturesForRound(round);
      }
      
      setFixtures(fixturesData || []);
      
      await new Promise(resolve => setTimeout(resolve, 400)); // Brief pause

      // Stage 3: Load results
      setLoadingStage('results');
      setLoadingMessage(`Calculating Round ${round} results...`);

      console.log(`Loading consolidated results for round ${round}`);
      
      const response = await fetch(`/api/consolidated-round-results?round=${round}&year=${selectedYear}`);
      
      if (!response.ok) {
        throw new Error(`Failed to load round data: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache both fixtures and round data
      roundCache.set(round, { roundData: data, fixtures: fixturesData });
      setRoundData(data);

      console.log(`Successfully loaded consolidated data for round ${round}`);

      // Stage 4: Complete
      setLoadingStage('complete');
      setLoadingMessage('');

    } catch (err) {
      console.error('Error loading round data:', err);
      setError(err.message);
      setLoadingStage('error');
      setLoadingMessage(`Error loading round ${round}`);
    }
  }, [roundCache, selectedYear]);

  // Load data when round changes
  useEffect(() => {
    if (displayRound !== null) {
      loadRoundData(displayRound);
    }
  }, [displayRound, loadRoundData]);

  // Determine if round is complete
  const isRoundComplete = useMemo(() => {
    if (!displayRound || !currentRound) return false;
    
    // Past rounds are complete
    if (displayRound < currentRound) return true;
    
    // Current round check from context
    if (displayRound === currentRound && roundInfo?.isRoundEnded) return true;
    
    return false;
  }, [displayRound, currentRound, roundInfo]);

  // Transform consolidated data to match original format for compatibility
  const transformedData = useMemo(() => {
    if (!roundData || !roundData.results) {
      return {
        teamScores: {},
        fixtures: [],
        highestScore: 0,
        lowestScore: 0,
        allTeamScores: []
      };
    }

    // Transform results to team scores format
    const teamScores = {};
    const allTeamScores = [];

    Object.entries(roundData.results).forEach(([userId, result]) => {
      // Transform position scores to match expected format
      const transformedPositions = (result.positions || []).map(pos => ({
        position: pos.position,
        playerName: pos.playerName || 'Not Selected',
        originalPlayerName: pos.originalPlayerName || pos.playerName || 'Not Selected',
        score: pos.score || 0,
        originalScore: pos.originalScore || pos.score || 0,
        breakdown: '', // API doesn't return breakdown, could be enhanced later
        hasPlayed: pos.hasPlayed || (pos.playerName && pos.score > 0),
        isBenchPlayer: pos.isSubstitution || false,
        noStats: pos.noStats || (!pos.playerName || pos.score === 0),
        replacementType: pos.substitutionType || null,
        player: pos.playerName ? {
          player_name: pos.playerName,
          hasPlayed: pos.hasPlayed || (pos.playerName && pos.score > 0)
        } : null,
        team: '' // Could be enhanced with team info if needed
      }));

      teamScores[userId] = {
        userId,
        totalScore: result.playerScore || 0,
        deadCertScore: result.deadCertScore || 0,
        finalScore: result.totalScore || 0,
        positionScores: transformedPositions,
        benchScores: result.benchScores || [],
        substitutionsEnabled: { bench: true, reserve: isRoundComplete },
        // Add match result data
        matchResult: result.matchResult,
        opponent: result.opponent,
        opponentScore: result.opponentScore,
        isHome: result.isHome,
        hasStar: result.hasStar,
        hasCrab: result.hasCrab
      };

      allTeamScores.push({
        userId,
        totalScore: result.totalScore || 0,
        teamOnly: result.playerScore || 0,
        deadCert: result.deadCertScore || 0
      });
    });

    return {
      teamScores,
      fixtures: [], // Will be calculated from match results
      highestScore: roundData.summary?.highestScore || 0,
      lowestScore: roundData.summary?.lowestScore || 0,
      allTeamScores
    };
  }, [roundData, isRoundComplete]);

  const changeRound = useCallback((newRound) => {
    if (newRound !== displayRound) {
      setLoadingStage('round');
      setLoadingMessage('Changing round...');
      setDisplayRound(newRound);
    }
  }, [displayRound]);

  // For compatibility with existing code
  const getTeamScores = useCallback((userId) => {
    return transformedData.teamScores[userId] || {
      userId,
      totalScore: 0,
      deadCertScore: 0,
      finalScore: 0,
      positionScores: [],
      benchScores: [],
      substitutionsEnabled: { bench: false, reserve: false }
    };
  }, [transformedData.teamScores]);

  const calculateAllTeamScores = useCallback(() => {
    return transformedData.allTeamScores;
  }, [transformedData.allTeamScores]);

  // Loading state helpers
  const loading = loadingStage !== 'complete';
  const isInitializing = loadingStage === 'initializing';

  return {
    // State
    currentRound: displayRound,
    teams: transformedData.teamScores,
    loading,
    error,
    roundEndPassed: isRoundComplete,
    roundInitialized: loadingStage === 'complete',
    
    // Progressive loading info
    loadingStage,
    loadingMessage,
    isInitializing,
    
    // Derived data
    teamScores: transformedData.teamScores,
    fixtures,
    highestScore: transformedData.highestScore,
    lowestScore: transformedData.lowestScore,
    
    // Actions
    changeRound,
    getTeamScores,
    calculateAllTeamScores,
    
    // Raw data for advanced usage
    roundData
  };
}
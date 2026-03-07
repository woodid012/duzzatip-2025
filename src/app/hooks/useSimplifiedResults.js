'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  const [isRefreshing, setIsRefreshing] = useState(false); // silent background refresh indicator

  // Ref to track which round is active, to guard against stale background refreshes
  const activeRoundRef = useRef(null);

  // Cache for round data to prevent refetching
  const roundCache = useRef(new Map()).current;

  // Clear cache when year changes
  useEffect(() => {
    roundCache.clear();
  }, [selectedYear]);

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
    activeRoundRef.current = round;
    setIsRefreshing(false);

    // Check cache first — but skip for live rounds (current or future)
    // so auto-refresh can fetch updated stats
    const isPastRound = currentRound !== undefined && round < currentRound;
    if (isPastRound && roundCache.has(round)) {
      const cachedData = roundCache.get(round);
      setRoundData(cachedData.roundData);
      setFixtures(cachedData.fixtures);
      setLoadingStage('complete');
      setLoadingMessage('');
      return;
    }
    // Clear stale cache for this round before refreshing
    roundCache.delete(round);

    try {
      setError(null);

      // Stage 1: Set up round
      setLoadingStage('round');
      setLoadingMessage(`Loading Round ${round} information...`);

      // Stage 2: Load fixtures
      setLoadingStage('fixtures');
      setLoadingMessage(`Loading Round ${round} fixtures...`);
      
      let fixturesData = [];
      if (isFinalRound(round)) {
        // For finals rounds, calculate fixtures dynamically
        fixturesData = await calculateFinalsFixtures(round, selectedYear);
      } else {
        // For regular season, use static fixtures
        fixturesData = getFixturesForRound(round);
      }
      
      setFixtures(fixturesData || []);

      // Stage 3: Load results immediately (don't wait for stats refresh)
      setLoadingStage('results');
      setLoadingMessage(`Calculating Round ${round} results...`);

      const response = await fetch(`/api/consolidated-round-results?round=${round}&year=${selectedYear}`);

      if (!response.ok) {
        throw new Error(`Failed to load round data: ${response.status}`);
      }

      const data = await response.json();

      // Cache both fixtures and round data
      roundCache.set(round, { roundData: data, fixtures: fixturesData });
      setRoundData(data);

      // Stage 4: Complete — page is visible
      setLoadingStage('complete');
      setLoadingMessage('');

      // For live rounds: kick off background stats refresh, then silently re-fetch results
      if (!isPastRound) {
        setIsRefreshing(true);
        fetch(`/api/update-round-stats?round=${round}&source=afl&ifStale=1`)
          .then(() => fetch(`/api/consolidated-round-results?round=${round}&year=${selectedYear}`))
          .then(res => res.ok ? res.json() : Promise.reject())
          .then(freshData => {
            if (round !== activeRoundRef.current) return;
            roundCache.set(round, { roundData: freshData, fixtures: fixturesData });
            setRoundData(freshData);
          })
          .catch(() => {}) // silent fail
          .finally(() => setIsRefreshing(false));
      }

    } catch (err) {
      console.error('Error loading round data:', err);
      setError(err.message);
      setLoadingStage('error');
      setLoadingMessage(`Error loading round ${round}`);
    }
  }, [selectedYear, currentRound]);

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
        breakdown: pos.breakdown || '',
        originalBreakdown: pos.originalBreakdown || '',
        isGameLive: pos.isGameLive || false,
        isGameFinished: pos.isGameFinished || false,
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
        deadCertDetails: result.deadCertDetails || [],
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
      deadCertDetails: [],
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
    isRefreshing,
    
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
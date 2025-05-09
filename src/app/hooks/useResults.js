'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR, POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';
import { POSITIONS } from '@/app/lib/scoring_rules';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

export default function useResults() {
  // Get context info immediately
  const appContext = useAppContext();
  const { currentRound, roundInfo, loading: contextLoading } = appContext;
  
  // Reference to track if we've already loaded data for this round
  const loadedRoundRef = useRef(null);
  const initializedRef = useRef(false);
  
  // State for the round displayed on the page - independent from global context
  const [localRound, setLocalRound] = useState(currentRound);
  
  // State for teams and player data
  const [teams, setTeams] = useState({});
  const [playerStats, setPlayerStats] = useState({});
  const [deadCertScores, setDeadCertScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [roundEndPassed, setRoundEndPassed] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const [playerTeamMap, setPlayerTeamMap] = useState({});
  
  // Add a state to track if data is initialized
  const [roundInitialized, setRoundInitialized] = useState(false);
  
  // Define which positions are handled by which reserve
  const RESERVE_A_POSITIONS = ['Full Forward', 'Tall Forward', 'Ruck'];
  const RESERVE_B_POSITIONS = ['Offensive', 'Midfielder', 'Tackler'];

  // Add debug state to track substitution attempts
  const [substitutionDebug, setSubstitutionDebug] = useState({
    ffStatus: null,
    reserveAStatus: null,
    benchStatus: null,
    didAttemptSubstitution: false,
    roundEndPassedReason: '',
    processingRound: null
  });
  
  // Determine initial round as part of the loading process
  useEffect(() => {
    const determineInitialRound = async () => {
      try {
        if (initializedRef.current) return;
        
        // First try to use context round if it's valid
        if (currentRound !== null && currentRound !== undefined && currentRound > 0) {
          console.log(`USERESULTS: Using context round ${currentRound}`);
          setLocalRound(currentRound);
        } else {
          // If context round is invalid or 0, fetch fixtures to determine the current round
          console.log(`USERESULTS: Context round is ${currentRound}, calculating locally`);
          
          // Get fixtures first by fetching from the tipping-data endpoint
          const fixturesRes = await fetch(`/api/tipping-data`);
          if (fixturesRes.ok) {
            const fixturesData = await fixturesRes.json();
            
            // Find the first fixture that hasn't been played yet
            const now = new Date();
            const sortedFixtures = fixturesData.sort((a, b) => 
              new Date(a.DateUtc) - new Date(b.DateUtc)
            );
            
            const nextFixture = sortedFixtures.find(fixture => 
              new Date(fixture.DateUtc) > now
            );
            
            // Current round is the round of the next fixture, or the last round if all fixtures are completed
            const calculatedRound = nextFixture 
              ? nextFixture.RoundNumber 
              : sortedFixtures[sortedFixtures.length - 1].RoundNumber;
            
            console.log(`USERESULTS: Calculated current round: ${calculatedRound}`);
            setLocalRound(calculatedRound > 0 ? calculatedRound : 1);
          } else {
            // Fallback to round 1 if fixtures can't be loaded
            console.log(`USERESULTS: Failed to load fixtures, defaulting to round 1`);
            setLocalRound(1);
          }
        }
        
        initializedRef.current = true;
      } catch (err) {
        console.error('Error determining initial round:', err);
        // Default to round 1 on error
        setLocalRound(1);
        initializedRef.current = true;
      }
    };

    determineInitialRound();
  }, [currentRound]);


  // Load data when local round changes
  useEffect(() => {
    // Skip if we've already loaded this round's data
    if (loadedRoundRef.current === localRound) {
      return;
    }
    
    const fetchData = async () => {
      try {
        setLoading(true);
        setRoundInitialized(false);
        console.log(`Fetching data for round: ${localRound}`);
        
        // Fetch squads to get player team information
        const squadsRes = await fetch('/api/squads');
        if (squadsRes.ok) {
          const squadsData = await squadsRes.json();
          
          // Create a map of player name to team
          const teamMap = {};
          Object.values(squadsData).forEach(userData => {
            userData.players.forEach(player => {
              if (player.name) {
                teamMap[player.name] = player.team;
              }
            });
          });
          
          setPlayerTeamMap(teamMap);
        }
        
        // Check round end status using roundInfo from context
        const checkRoundEndStatus = () => {
          try {
            // Make very sure we have the right context information
            console.log('DEBUG ---- Round End Detection ----');
            console.log('AppContext roundInfo:', roundInfo);
            console.log('Current round from context:', currentRound);
            console.log('Local round being checked:', localRound);
            
            let roundEndPassedReason = '';
            
            // For the current round, check the global context's roundInfo
            console.log('Round info from global context:', roundInfo);
            
            // Add force flag for round 6
            if (localRound === 6) {
              console.log('DEBUG: FORCING ROUND 6 TO BE CONSIDERED ENDED');
              setRoundEndPassed(true);
              roundEndPassedReason = 'Forced for Round 6';
              setSubstitutionDebug(prev => ({
                ...prev, 
                roundEndPassedReason: 'Forced for Round 6',
                processingRound: localRound
              }));
              return;
            }
            
            // Check if we can get the isRoundEnded flag directly
            if (roundInfo && typeof roundInfo.isRoundEnded === 'boolean') {
              console.log(`Using isRoundEnded flag from context: ${roundInfo.isRoundEnded}`);
              setRoundEndPassed(roundInfo.isRoundEnded);
              roundEndPassedReason = 'Direct isRoundEnded flag';
              return;
            }
            
            // Get the appropriate round info based on which round we're looking at
            let targetRoundInfo = null;
            
            if (localRound === currentRound) {
              // For current round, use the context's roundInfo directly
              targetRoundInfo = roundInfo;
              console.log('Using direct roundInfo for current round:', targetRoundInfo);
            } else if (appContext.getSpecificRoundInfo) {
              // For other rounds, try to get specific round info if available
              targetRoundInfo = appContext.getSpecificRoundInfo(localRound);
              console.log(`Retrieved specific round info for round ${localRound}:`, targetRoundInfo);
            }
            
            // Time-based check using round end time from the appropriate round info
            let roundEndTime = null;
            
            // 1. Try direct roundEndTime from target round info
            if (targetRoundInfo && targetRoundInfo.roundEndTime) {
              roundEndTime = targetRoundInfo.roundEndTime;
              console.log('Found roundEndTime in targetRoundInfo:', roundEndTime);
            }
            // 2. Try roundEndDate (which might be a Date object)
            else if (targetRoundInfo && targetRoundInfo.roundEndDate) {
              roundEndTime = targetRoundInfo.roundEndDate;
              console.log('Found roundEndDate in targetRoundInfo:', roundEndTime);
            }
            // 3. If we're checking past rounds and can't get specific info, assume they ended
            else if (localRound < currentRound) {
              console.log(`Past round ${localRound} with no end time available, assuming ended`);
              setRoundEndPassed(true);
              roundEndPassedReason = `Past round (${localRound} < ${currentRound})`;
              setSubstitutionDebug(prev => ({
                ...prev, 
                roundEndPassedReason: `Past round (${localRound} < ${currentRound})`,
                processingRound: localRound
              }));
              return;
            }
            
            if (roundEndTime) {
              // Convert to Date if it's a string
              const roundEndDate = roundEndTime instanceof Date ? roundEndTime : new Date(roundEndTime);
              const now = new Date();
              
              console.log('Round end time/date from context:', roundEndTime);
              console.log('Parsed round end date:', roundEndDate);
              console.log('Current time:', now.toISOString());
              console.log('Round has ended comparison result:', now > roundEndDate);
              
              // Check if we're past the round end time
              const hasEnded = now > roundEndDate;
              setRoundEndPassed(hasEnded);
              if (hasEnded) {
                roundEndPassedReason = `Current time (${now.toISOString()}) > Round end (${roundEndDate})`;
              } else {
                roundEndPassedReason = `Current time (${now.toISOString()}) < Round end (${roundEndDate})`;
              }
              setSubstitutionDebug(prev => ({
                ...prev, 
                roundEndPassedReason,
                processingRound: localRound
              }));
              return;
            }
            
            // Last resort - see if there's any hint in round info about the round being completed
            if (roundInfo) {
              if (roundInfo.isCompleted || roundInfo.status === 'completed') {
                console.log('Round marked as completed in context');
                setRoundEndPassed(true);
                roundEndPassedReason = 'Round marked as completed';
                return;
              }
            }
            
            // If we got here, we couldn't determine from context, so use more general heuristics
            // Any round before the current round is considered completed
            if (localRound < currentRound) {
              console.log(`Round ${localRound} is before current round ${currentRound}, marking as completed`);
              setRoundEndPassed(true);
              roundEndPassedReason = `Past round (${localRound} < ${currentRound})`;
              setSubstitutionDebug(prev => ({
                ...prev, 
                roundEndPassedReason: `Past round (${localRound} < ${currentRound})`,
                processingRound: localRound
              }));
              return;
            }
            
            // Default fallback
            console.log('Could not determine if round has ended, defaulting to false');
            setRoundEndPassed(false);
            roundEndPassedReason = 'Default fallback - could not determine';
            setSubstitutionDebug(prev => ({
                ...prev, 
                roundEndPassedReason,
                processingRound: localRound
            }));
          } catch (err) {
            console.error('Error checking round end status:', err);
            
            // Fallback to safe choice - rounds before current round have ended
            if (localRound < currentRound) {
              console.log('Fallback: Round is before current round, marking as ended');
              setRoundEndPassed(true);
              setSubstitutionDebug(prev => ({
                ...prev, 
                roundEndPassedReason: `Fallback - past round (${localRound} < ${currentRound})`,
                processingRound: localRound
              }));
            } else {
              setRoundEndPassed(false);
              setSubstitutionDebug(prev => ({
                ...prev, 
                roundEndPassedReason: 'Error in check - defaulting to false',
                processingRound: localRound
              }));
            }
          }
        };
        
        // Check round end status
        checkRoundEndStatus();
        
        // Fetch teams and player stats for the correct round
        const teamsRes = await fetch(`/api/team-selection?round=${localRound}`);
        if (!teamsRes.ok) throw new Error('Failed to fetch teams');
        const teamsData = await teamsRes.json();
        setTeams(teamsData);
    
        // Fetch dead cert scores for all users (1-8)
        const deadCertPromises = Array.from({ length: 8 }, (_, i) => i + 1).map(userId => 
          fetch(`/api/tipping-results?round=${localRound}&userId=${userId}`)
            .then(res => res.json())
            .catch(() => ({ deadCertScore: 0 })) // Default value if fetch fails
        );
        const deadCertResults = await Promise.all(deadCertPromises);
        const deadCertMap = {};
        deadCertResults.forEach((result, index) => {
          const userId = index + 1;
          deadCertMap[userId] = result.deadCertScore || 0;
        });
        setDeadCertScores(deadCertMap);

        // Fetch player stats for each team - FIX: Add null checks
        const allStats = {};
        for (const [userId, team] of Object.entries(teamsData)) {
          // Collect all player names for this team - FIX: Add null check
          const playerNames = Object.values(team)
            .filter(data => data !== null && data !== undefined) // Add explicit null check
            .map(data => data.player_name)
            .filter(Boolean); // Remove any undefined/null values
    
          if (playerNames.length === 0) continue;

          // Make a single API call for all players in the team
          const res = await fetch(`/api/player-stats?round=${localRound}&players=${encodeURIComponent(playerNames.join(','))}`);
          if (!res.ok) throw new Error('Failed to fetch player stats');
          const statsData = await res.json();
    
          // Process the stats for each player
          const playerStats = {};
          for (const [position, data] of Object.entries(team)) {
            // FIX: Skip if position data is null or undefined
            if (!data) continue;
            
            const playerName = data.player_name;
            if (!playerName) continue;
            
            const stats = statsData[playerName];
            const positionType = position.toUpperCase().replace(/\s+/g, '_');
            
            // Ensure stats exists before trying to calculate score
            let scoring = { total: 0, breakdown: [] };
            if (stats) {
              scoring = calculateScore(positionType, stats, data.backup_position);
            }
            
            // Check if player has any stats (if they played)
            const hasPlayed = stats && (
              (stats.kicks && stats.kicks > 0) || 
              (stats.handballs && stats.handballs > 0) || 
              (stats.marks && stats.marks > 0) || 
              (stats.tackles && stats.tackles > 0) || 
              (stats.hitouts && stats.hitouts > 0) || 
              (stats.goals && stats.goals > 0) || 
              (stats.behinds && stats.behinds > 0)
            );
            
            playerStats[playerName] = {
              ...stats,
              team: playerTeamMap[playerName] || (stats ? stats.team_name : ''),
              scoring,
              backup_position: data.backup_position,
              original_position: position,
              hasPlayed: hasPlayed
            };
          }
          allStats[userId] = playerStats;
        }
        setPlayerStats(allStats);
        
        // Mark this round as loaded
        loadedRoundRef.current = localRound;
        setRoundInitialized(true);
      } catch (err) {
        console.error('Error fetching results data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
  }, [localRound, currentRound, roundInfo, appContext]);

  // Create a local changeRound function that doesn't affect global context
  const handleRoundChange = (roundNumber) => {
    if (roundNumber !== localRound) {
      console.log(`Changing local round to ${roundNumber} (not affecting global context)`);
      setLocalRound(roundNumber);
      loadedRoundRef.current = null; // Force a data reload
    }
  };

  // Calculate score for a position with proper null checks
  const calculateScore = (position, stats, backupPosition = null) => {
    // Ensure stats exists
    if (!stats) return { total: 0, breakdown: [] };
    
    // Add default values for stats that might be missing
    const safeStats = {
      kicks: stats.kicks || 0,
      handballs: stats.handballs || 0,
      marks: stats.marks || 0,
      tackles: stats.tackles || 0,
      hitouts: stats.hitouts || 0,
      goals: stats.goals || 0,
      behinds: stats.behinds || 0,
      ...stats
    };
    
    // If it's a bench position, use the backup position for scoring
    if ((position === 'BENCH' || position.startsWith('RESERVE')) && backupPosition) {
      const backupPositionType = backupPosition.toUpperCase().replace(/\s+/g, '_');
      try {
        return POSITIONS[backupPositionType]?.calculation(safeStats) || { total: 0, breakdown: [] };
      } catch (error) {
        console.error(`Error calculating score for ${backupPositionType}:`, error);
        return { total: 0, breakdown: [] };
      }
    }

    // For regular positions, use the position's scoring rules
    const formattedPosition = position.replace(/\s+/g, '_');
    try {
      return POSITIONS[formattedPosition]?.calculation(safeStats) || { total: 0, breakdown: [] };
    } catch (error) {
      console.error(`Error calculating score for ${formattedPosition}:`, error);
      return { total: 0, breakdown: [] };
    }
  };

  // Function to check if a player's stats indicate they played
  const didPlayerPlay = (stats) => {
    if (!stats) return false;
    
    return (
      (stats.kicks && stats.kicks > 0) || 
      (stats.handballs && stats.handballs > 0) || 
      (stats.marks && stats.marks > 0) || 
      (stats.tackles && stats.tackles > 0) || 
      (stats.hitouts && stats.hitouts > 0) || 
      (stats.goals && stats.goals > 0) || 
      (stats.behinds && stats.behinds > 0)
    );
  };
  
  // Force round end passed for round 6 - uncomment this line to force it
  // const forceRoundEndPassed = localRound === 6;
  const forceRoundEndPassed = false;

  // Calculate all team scores to determine highest and lowest
  const calculateAllTeamScores = useCallback(() => {
    return Object.entries(teams).map(([userId, team]) => {
      // Use the same logic as getTeamScores but just return the final score
      const teamScoreData = getTeamScores(userId);
      return { 
        userId, 
        totalScore: teamScoreData.finalScore 
      };
    });
  }, [teams]);

  // Get scores for a specific team - memoize with useCallback to prevent recreation on each render
  const getTeamScores = useCallback((userId) => {
    const userTeam = teams[userId] || {};
    const debugData = [];
    
    // Extract bench players with their backup positions
    const benchPlayers = Object.entries(userTeam)
      .filter(([pos]) => pos === 'Bench')
      .map(([pos, data]) => {
        // FIX: Add null check for data
        if (!data || !data.player_name || !data.backup_position) return null;
        
        const stats = playerStats[userId]?.[data.player_name];
        // Check if bench player played
        const hasPlayed = didPlayerPlay(stats);
        
        if (!hasPlayed) return null; // Skip bench players who didn't play
        
        // Calculate the bench player's score in their backup position
        const backupPosType = data.backup_position.toUpperCase().replace(/\s+/g, '_');
        const scoring = calculateScore(backupPosType, stats);
        
        return {
          position: pos,
          playerName: data.player_name,
          backupPosition: data.backup_position,
          stats,
          score: scoring?.total || 0,
          breakdown: scoring?.breakdown || '',
          hasPlayed
        };
      })
      .filter(Boolean); // Remove nulls
    
    // Extract reserve players
    const reservePlayers = Object.entries(userTeam)
      .filter(([pos]) => pos.startsWith('Reserve'))
      .map(([pos, data]) => {
        // FIX: Add null check for data
        if (!data || !data.player_name) return null;
        
        const stats = playerStats[userId]?.[data.player_name];
        const hasPlayed = didPlayerPlay(stats);
        
        if (!hasPlayed) return null; // Skip reserve players who didn't play
        
        // For reserves, associate them with their position type
        const isReserveA = pos === 'Reserve A';
        const validPositions = isReserveA ? RESERVE_A_POSITIONS : RESERVE_B_POSITIONS;
        
        // Add direct backup position if specified
        if (data.backup_position) {
          validPositions.push(data.backup_position);
        }
        
        return {
          position: pos,
          playerName: data.player_name,
          backupPosition: data.backup_position,
          stats,
          hasPlayed,
          validPositions,
          isReserveA
        };
      })
      .filter(Boolean);
    
    // Process main positions and apply substitutions
    const usedBenchPlayers = new Set();
    const usedReservePlayers = new Set();
    
    // First, calculate scores for all main positions with original scores
    const positionScores = POSITION_TYPES
      .filter(pos => !pos.includes('Bench') && !pos.includes('Reserve'))
      .map(position => {
        const playerData = userTeam[position];
        // FIX: Add null check for playerData
        if (!playerData || !playerData.player_name) {
          return {
            position,
            playerName: null,
            score: 0,
            isBenchPlayer: false
          };
        }
        
        const playerName = playerData.player_name;
        const stats = playerStats[userId]?.[playerName];
        const hasPlayed = didPlayerPlay(stats);
        
        // Calculate original score
        const positionType = position.toUpperCase().replace(/\s+/g, '_');
        const scoring = calculateScore(positionType, stats);
        const originalScore = scoring?.total || 0;
        const breakdown = scoring?.breakdown || '';
        
        // Return position data with score
        return {
          position,
          playerName,
          originalPlayerName: playerName,
          player: stats,
          score: originalScore, // For now, set the score to the original score
          originalScore, // Keep track of the original score separately
          breakdown,
          hasPlayed,
          isBenchPlayer: false,
          noStats: !hasPlayed,
          team: stats?.team || playerTeamMap[playerName] // Store original player's team
        };
      });
    
    // Log the Full Forward status
    const ffPosition = positionScores.find(p => p.position === 'Full Forward');
    console.log(`DEBUG [${userId}] Full Forward Status:`, {
      name: ffPosition?.playerName,
      hasPlayed: ffPosition?.hasPlayed,
      noStats: ffPosition?.noStats,
      stats: ffPosition?.player ? 'Has stats' : 'No stats'
    });
    
    // Log the Reserve A status
    const reserveA = reservePlayers.find(r => r.position === 'Reserve A');
    console.log(`DEBUG [${userId}] Reserve A Status:`, {
      name: reserveA?.playerName,
      hasPlayed: reserveA?.hasPlayed,
      validForFF: RESERVE_A_POSITIONS.includes('Full Forward'),
      stats: reserveA?.stats ? 'Has stats' : 'No stats'
    });
    
    // Log the Bench players for FF
    const benchForFF = benchPlayers.filter(b => b.backupPosition === 'Full Forward');
    console.log(`DEBUG [${userId}] Bench players for FF:`, 
      benchForFF.length > 0 
        ? benchForFF.map(b => b.playerName) 
        : 'None'
    );
    
    // Save FF and Reserve A status for debugging
    if (localRound === 6) {
      setSubstitutionDebug(prev => ({
        ...prev,
        ffStatus: ffPosition ? {
          name: ffPosition.playerName,
          hasPlayed: ffPosition.hasPlayed,
          noStats: ffPosition.noStats
        } : null,
        reserveAStatus: reserveA ? {
          name: reserveA.playerName,
          hasPlayed: reserveA.hasPlayed,
          validForFF: RESERVE_A_POSITIONS.includes('Full Forward')
        } : null,
        benchStatus: benchForFF.length > 0 
          ? benchForFF.map(b => ({ name: b.playerName, score: b.score }))
          : null,
      }));
    }
    
    // Step 1: Check if any bench player has a higher score than their backup position player
    for (const benchPlayer of benchPlayers) {
      const { backupPosition, playerName, score } = benchPlayer;
      
      // Find the position this bench player can back up
      const positionIndex = positionScores.findIndex(p => p.position === backupPosition);
      if (positionIndex === -1) continue;
      
      const positionPlayer = positionScores[positionIndex];
      const originalScore = positionPlayer.score;
      
      // Compare scores - if bench is higher, substitute
      if (score > originalScore) {
        debugData.push({
          message: `Bench player ${playerName} score (${score}) > ${positionPlayer.playerName} score (${originalScore}) for position ${backupPosition}`,
        });
        
        // Update the position with the bench player's score
        positionScores[positionIndex] = {
          ...positionPlayer,
          player: {
            ...benchPlayer.stats,
            originalTeam: positionPlayer.player?.team // Keep original player's team
          },
          playerName: benchPlayer.playerName,
          score: benchPlayer.score, // For total calculation
          originalScore, // Original player's score stays
          breakdown: benchPlayer.breakdown,
          isBenchPlayer: true,
          replacementType: 'Bench',
          team: positionPlayer.team // Preserve original player's team
        };
        
        // Mark this bench player as used
        usedBenchPlayers.add(playerName);
      }
    }
    
    // Step 2: Check if any main position player didn't play and needs a substitute
    // (only apply reserve substitutions if round has ended or force flag is on)
    if (roundEndPassed || forceRoundEndPassed) {
      console.log(`DEBUG [${userId}] Round end passed (${roundEndPassed}) or forced (${forceRoundEndPassed}) for user, applying reserve substitutions`);
      
      // If we reach here, the substitution should be attempted
      if (localRound === 6) {
        setSubstitutionDebug(prev => ({
          ...prev,
          didAttemptSubstitution: true
        }));
      }
      
      for (let i = 0; i < positionScores.length; i++) {
        const positionData = positionScores[i];
        
        // Skip positions where player played or already has a bench substitution
        if (positionData.hasPlayed || positionData.isBenchPlayer) {
          if (positionData.position === 'Full Forward') {
            console.log(`DEBUG [${userId}] Skipping FF substitution because:`, {
              hasPlayed: positionData.hasPlayed,
              isBenchPlayer: positionData.isBenchPlayer
            });
          }
          continue;
        }
        
        const position = positionData.position;
        const originalScore = positionData.score; // Original score (should be 0 for DNP players)
        
        console.log(`DEBUG [${userId}] Checking substitution for ${position}:`, {
          playerName: positionData.playerName,
          hasPlayed: positionData.hasPlayed,
          needsSubstitution: !positionData.hasPlayed && !positionData.isBenchPlayer
        });
        
        // First try remaining bench players with matching backup
        const eligibleBench = benchPlayers
          .filter(b => !usedBenchPlayers.has(b.playerName) && b.backupPosition === position)
          .sort((a, b) => b.score - a.score);
        
        console.log(`DEBUG [${userId}] Eligible bench players for ${position}:`, 
          eligibleBench.length > 0 
            ? eligibleBench.map(b => `${b.playerName} (${b.score})`) 
            : 'None');
        
        if (eligibleBench.length > 0) {
          const bestBench = eligibleBench[0];
          
          console.log(`DEBUG [${userId}] Substituting ${position} with bench player ${bestBench.playerName} (${bestBench.score} pts)`);
          
          // Apply substitution
          positionScores[i] = {
            ...positionData,
            player: {
              ...bestBench.stats,
              originalTeam: positionData.player?.team // Keep original player's team
            },
            playerName: bestBench.playerName,
            score: bestBench.score, // For total calculation
            originalScore, // Original player's score stays
            breakdown: bestBench.breakdown,
            isBenchPlayer: true,
            replacementType: 'Bench',
            team: positionData.team // Preserve original player's team
          };
          
          // Mark as used
          usedBenchPlayers.add(bestBench.playerName);
          continue; // Move to next position
        }
        
        
        // If no bench player found, try reserve players
        const isReserveAPosition = RESERVE_A_POSITIONS.includes(position);
        const isReserveBPosition = RESERVE_B_POSITIONS.includes(position);
        
        console.log(`DEBUG [${userId}] Is ${position} a Reserve A position?`, isReserveAPosition);
        console.log(`DEBUG [${userId}] Is ${position} a Reserve B position?`, isReserveBPosition);
        
        // Find eligible reserves (not used and matches position type)
        const eligibleReserves = reservePlayers
          .filter(r => {
            // Skip already used reserves
            if (usedReservePlayers.has(r.playerName)) {
              console.log(`DEBUG [${userId}] Reserve ${r.playerName} already used, skipping`);
              return false;
            }
            
            // Check if this reserve covers this position
            if (r.backupPosition === position) {
              console.log(`DEBUG [${userId}] Reserve ${r.playerName} has direct backup for ${position}`);
              return true;
            }
            
            // Check position type match
            const matchesType = (r.isReserveA && isReserveAPosition) || 
                  (!r.isReserveA && isReserveBPosition);
            
            console.log(`DEBUG [${userId}] Reserve ${r.playerName} ${r.isReserveA ? 'A' : 'B'} match for ${position}: ${matchesType}`);
            return matchesType;
          });
        
        console.log(`DEBUG [${userId}] Eligible reserves for ${position}:`, 
          eligibleReserves.length > 0 
            ? eligibleReserves.map(r => r.playerName) 
            : 'None');
        
        if (eligibleReserves.length > 0) {
          // Calculate scores for each eligible reserve in this position
          const reserveScores = eligibleReserves.map(reserve => {
            const positionType = position.toUpperCase().replace(/\s+/g, '_');
            const scoring = calculateScore(positionType, reserve.stats);
            return {
              ...reserve,
              calculatedScore: scoring?.total || 0,
              breakdown: scoring?.breakdown || '',
              // Priority: direct backup > position type match
              priority: reserve.backupPosition === position ? 2 : 1
            };
          });
          
          // Sort by priority first, then score
          reserveScores.sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return b.calculatedScore - a.calculatedScore;
          });
          
          // Log the sorted reserves
          console.log(`DEBUG [${userId}] Sorted reserves for ${position}:`, 
            reserveScores.map(r => `${r.playerName} (prio: ${r.priority}, score: ${r.calculatedScore})`));
          
          // Use best reserve
          if (reserveScores.length > 0) {
            const bestReserve = reserveScores[0];
            
            console.log(`DEBUG [${userId}] Substituting ${position} with reserve ${bestReserve.playerName} (${bestReserve.calculatedScore} pts)`);
            
            // Apply substitution
            positionScores[i] = {
              ...positionData,
              player: {
                ...bestReserve.stats,
                originalTeam: positionData.player?.team // Keep original player's team
              },
              playerName: bestReserve.playerName,
              score: bestReserve.calculatedScore, // For total calculation
              originalScore, // Original player's score stays
              breakdown: bestReserve.breakdown,
              isBenchPlayer: true,
              replacementType: bestReserve.position,
              team: positionData.team // Preserve original player's team
            };
            
            // Mark as used
            usedReservePlayers.add(bestReserve.playerName);
          }
        } else {
          console.log(`DEBUG [${userId}] No eligible reserves found for ${position}`);
        }
      }
    }
    
    // Log the final position scores after substitution
    console.log(`DEBUG [${userId}] Final position scores after substitution:`, 
      positionScores.map(pos => ({
        position: pos.position,
        playerName: pos.playerName,
        originalName: pos.originalPlayerName,
        score: pos.score,
        wasSubstituted: pos.isBenchPlayer,
        replacementType: pos.replacementType
      }))
    );
    
    // Check if Full Forward had a replacement
    const ffPositionFinal = positionScores.find(p => p.position === 'Full Forward');
    if (ffPositionFinal) {
      console.log(`DEBUG [${userId}] Final Full Forward Status:`, {
        playerName: ffPositionFinal.playerName,
        originalName: ffPositionFinal.originalPlayerName,
        wasSubstituted: ffPositionFinal.isBenchPlayer,
        replacementType: ffPositionFinal.replacementType,
        score: ffPositionFinal.score
      });
    }
    
    // Now prepare the bench/reserve display data
    const benchScores = [...Object.entries(userTeam)
      .filter(([pos]) => pos === 'Bench' || pos.startsWith('Reserve'))
      .map(([position, data]) => {
        // FIX: Add null check for data
        if (!data || !data.player_name) return null;
        
        const playerName = data.player_name;
        const stats = playerStats[userId]?.[playerName];
        const backupPosition = data.backup_position;
        
        // Check if this bench/reserve is being used to replace a player
        const isBeingUsed = 
          usedBenchPlayers.has(playerName) || 
          usedReservePlayers.has(playerName);
        
        // Find which position this player is replacing
        const replacedPosition = positionScores.find(
          pos => pos.isBenchPlayer && pos.playerName === playerName
        );
        
        // Log bench/reserve usage
        console.log(`DEBUG [${userId}] Bench/Reserve ${playerName} (${position}):`, {
          isBeingUsed,
          replacingPosition: isBeingUsed && replacedPosition ? replacedPosition.position : null,
          replacingPlayerName: isBeingUsed && replacedPosition ? replacedPosition.originalPlayerName : null,
          didPlay: didPlayerPlay(stats)
        });
        
        return {
          position,
          backupPosition,
          player: stats,
          playerName,
          score: stats?.scoring?.total || 0,
          breakdown: stats?.scoring?.breakdown || '',
          isBeingUsed,
          replacingPosition: isBeingUsed && replacedPosition ? replacedPosition.position : null,
          replacingPlayerName: isBeingUsed && replacedPosition ? replacedPosition.originalPlayerName : null,
          didPlay: didPlayerPlay(stats)
        };
      })
      .filter(Boolean)];

    // Calculate total score (using the substituted scores for the total)
    const totalScore = positionScores.reduce((total, pos) => total + pos.score, 0);
    const deadCertScore = deadCertScores[userId] || 0;
    const finalScore = totalScore + deadCertScore;

    // Collate all debug info
    const allDebugInfo = {
      ...debugData,
      roundEndPassed,
      forceRoundEndPassed,
      roundEndPassedReason: substitutionDebug.roundEndPassedReason,
      fullForwardFinal: ffPositionFinal ? {
        playerName: ffPositionFinal.playerName,
        originalName: ffPositionFinal.originalPlayerName,
        wasSubstituted: ffPositionFinal.isBenchPlayer,
        replacementType: ffPositionFinal.replacementType,
        score: ffPositionFinal.score
      } : null,
      reserveAStatus: substitutionDebug.reserveAStatus,
      benchForFFStatus: substitutionDebug.benchStatus,
      didAttemptSubstitution: substitutionDebug.didAttemptSubstitution
    };
    
    return {
      userId,
      totalScore,
      deadCertScore,
      finalScore,
      positionScores,
      benchScores,
      substitutionsEnabled: {
        bench: true, // Bench players can always be substituted
        reserve: roundEndPassed || forceRoundEndPassed // Reserve A/B only when round has ended or forced
      },
      debugInfo: allDebugInfo
    };
  }, [teams, playerStats, deadCertScores, roundEndPassed, playerTeamMap, substitutionDebug]);

  // Add function to get debugging info
  const getDebugInfo = useCallback(() => {
    return {
      currentRound: localRound,
      globalRound: currentRound,
      roundEndPassed,
      roundEndPassedReason: substitutionDebug.roundEndPassedReason,
      forceRoundEndPassed,
      ffStatus: substitutionDebug.ffStatus,
      reserveAStatus: substitutionDebug.reserveAStatus,
      benchForFF: substitutionDebug.benchStatus,
      didAttemptSubstitution: substitutionDebug.didAttemptSubstitution,
      processingRound: substitutionDebug.processingRound
    };
  }, [localRound, currentRound, roundEndPassed, substitutionDebug, forceRoundEndPassed]);

  return {
    // State
    currentRound: localRound, 
    teams,
    playerStats,
    deadCertScores,
    loading,
    error,
    roundEndPassed,
    debugInfo,
    roundInitialized,
    
    // Actions
    changeRound: handleRoundChange, // Use our local function instead of the global one
    calculateAllTeamScores,
    getTeamScores,
    getDebugInfo // Add new debugging function
  };
}
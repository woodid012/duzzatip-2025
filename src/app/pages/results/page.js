// src/app/pages/results/page.js

'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useAppContext } from '@/app/context/AppContext';
import useSimplifiedResults from '@/app/hooks/useSimplifiedResults';
import { USER_NAMES } from '@/app/lib/constants';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { calculateFinalsFixtures, isFinalRound, getFinalsRoundName } from '@/app/lib/finals_utils';
import { useUserContext } from '../layout';

// Import the modular components
import { TeamScoreCard, WelcomeScreen } from './components';
// Import a new component we'll create for the enhanced round summary
import EnhancedRoundSummary from './components/EnhancedRoundSummary';
import MobileLiveScoreboard from './components/MobileLiveScoreboard';

export default function ResultsPage() {
  // Get data from our app context
  const { currentRound, roundInfo, fixtures, selectedYear } = useAppContext();

  // Get the selected user + auth state from context
  const { selectedUserId, authedUserId, isAdminAuthenticated } = useUserContext();
  const isLoggedIn = isAdminAuthenticated || authedUserId !== null;

  // Public (not-logged-in) visitors are locked to the live/last started round.
  const publicRound = useMemo(() => {
    if (!fixtures || fixtures.length === 0) return currentRound ?? 0;
    const now = Date.now();
    const started = fixtures.filter((f) => new Date(f.DateUtc).getTime() <= now);
    if (started.length === 0) return 0;
    return Math.max(...started.map((f) => Number(f.RoundNumber)));
  }, [fixtures, currentRound]);
  
  // Get results functionality from our simplified hook
  const {
    currentRound: displayedRound,
    teamScores,
    loading,
    error,
    roundEndPassed,
    calculateAllTeamScores,
    getTeamScores,
    changeRound,
    refresh,
    roundData,
    loadingStage,
    loadingMessage,
    isRefreshing,
    fixtures: hookFixtures
  } = useSimplifiedResults();

  // Keep public visitors pinned to the live/last round (no round browsing).
  useEffect(() => {
    if (isLoggedIn) return;
    if (!fixtures || fixtures.length === 0) return;
    if (displayedRound !== publicRound) changeRound(publicRound);
  }, [isLoggedIn, fixtures, publicRound, displayedRound, changeRound]);

  // State for ordered fixtures (prioritizing selected user)
  const [orderedFixtures, setOrderedFixtures] = useState([]);
  
  // Update ordered fixtures when hook fixtures or selected user changes
  useEffect(() => {
    if (!hookFixtures || hookFixtures.length === 0) return;
    
    // Prioritize the selected user's fixture if applicable
    if (selectedUserId && hookFixtures.length > 0) {
      const userFixture = hookFixtures.find(fixture => 
        fixture.home?.toString() === selectedUserId?.toString() || 
        fixture.away?.toString() === selectedUserId?.toString()
      );
      
      if (userFixture) {
        setOrderedFixtures([
          userFixture,
          ...hookFixtures.filter(fixture => fixture !== userFixture)
        ]);
      } else {
        setOrderedFixtures(hookFixtures);
      }
    } else {
      setOrderedFixtures(hookFixtures);
    }
  }, [hookFixtures, selectedUserId]);

  // Handle round change - simplified
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    if (newRound !== displayedRound) {
      changeRound(newRound);
    }
  };

  // Display round name
  const displayRoundName = (round) => {
    if (round === 0) return 'Opening Round';
    if (isFinalRound(round)) {
      return getFinalsRoundName(round);
    }
    return `Round ${round}`;
  };

  // Calculate all team scores using the simplified data
  // NOTE: All hooks must be called before any early returns
  const allTeamScores = useMemo(() => calculateAllTeamScores(), [calculateAllTeamScores]);

  // Store final totals for ladder (only when round or scores change, not on every render)
  const storeFinalTotalsRef = useRef(null);
  storeFinalTotalsRef.current = async (scores, round) => {
    try {
      const finalTotals = {};
      scores.forEach(team => {
        finalTotals[team.userId] = team.totalScore || 0;
      });

      console.log(`Storing Final Totals for round ${round} for ladder:`, finalTotals);

      const response = await fetch('/api/final-totals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round, allFinalTotals: finalTotals })
      });

      if (response.ok) {
        console.log(`Successfully stored Final Totals for round ${round}`);
      } else {
        console.warn(`Failed to store Final Totals for round ${round}`);
      }
    } catch (err) {
      console.error(`Error storing Final Totals for round ${round}:`, err);
    }
  };

  useEffect(() => {
    if (displayedRound !== null && displayedRound !== undefined && allTeamScores.length > 0) {
      storeFinalTotalsRef.current(allTeamScores, displayedRound);
    }
  }, [displayedRound, allTeamScores]);

  // Filter out any zero or undefined scores for comparison
  const validScores = useMemo(() => allTeamScores.filter(s => (s?.totalScore || 0) > 0), [allTeamScores]);
  const highestScore = validScores.length > 0
    ? Math.max(...validScores.map(s => s?.totalScore || 0))
    : 0;
  const lowestScore = validScores.length > 0
    ? Math.min(...validScores.map(s => s?.totalScore || 0))
    : 0;

  const hasSubstitutions = roundEndPassed;

  // ── Scoreboard derivations ────────────────────────────────────────────────
  // Map each team to its opponent this round, so expanding/collapsing one card
  // (or clicking a fixture) acts on the whole matchup.
  const opponentOf = useMemo(() => {
    const m = {};
    (orderedFixtures || []).forEach((f) => {
      if (f.home != null && f.away != null) {
        m[String(f.home)] = String(f.away);
        m[String(f.away)] = String(f.home);
      }
    });
    return m;
  }, [orderedFixtures]);

  // Collapsible cards: the logged-in user's own team is always open. Toggling a
  // card toggles its opponent's card too (whole matchup expands/collapses).
  const [openCards, setOpenCards] = useState({});
  const toggleCard = useCallback((id) => {
    setOpenCards((prev) => {
      const next = !prev[id];
      const out = { ...prev, [id]: next };
      const opp = opponentOf[String(id)];
      if (opp) out[opp] = next;
      return out;
    });
  }, [opponentOf]);

  // The logged-in user's opponent this round (their team is always expanded too).
  const opponentId = useMemo(() => {
    if (!selectedUserId || !orderedFixtures || orderedFixtures.length === 0) return null;
    const f = orderedFixtures.find(
      (fx) => String(fx.home) === String(selectedUserId) || String(fx.away) === String(selectedUserId)
    );
    if (!f) return null;
    return String(f.home) === String(selectedUserId) ? String(f.away) : String(f.home);
  }, [orderedFixtures, selectedUserId]);

  // Rank every team by final score (desc).
  const rankMap = useMemo(() => {
    const arr = [...allTeamScores].sort((a, b) => (b?.totalScore || 0) - (a?.totalScore || 0));
    const m = {};
    arr.forEach((s, i) => { if (s?.userId != null) m[s.userId] = i + 1; });
    return m;
  }, [allTeamScores]);

  // Header stat tiles: top / average / wooden spoon (all from final score).
  const headerStats = useMemo(() => {
    const finals = allTeamScores.map((s) => s?.totalScore || 0).filter((n) => n > 0);
    if (finals.length === 0) return { top: 0, topName: '', low: 0, lowName: '', avg: 0 };
    const sorted = [...allTeamScores].filter((s) => (s?.totalScore || 0) > 0)
      .sort((a, b) => (b?.totalScore || 0) - (a?.totalScore || 0));
    const topEntry = sorted[0];
    const lowEntry = sorted[sorted.length - 1];
    return {
      top: topEntry?.totalScore || 0,
      topName: USER_NAMES[topEntry?.userId] || '',
      low: lowEntry?.totalScore || 0,
      lowName: USER_NAMES[lowEntry?.userId] || '',
      avg: Math.round(finals.reduce((a, b) => a + b, 0) / finals.length),
    };
  }, [allTeamScores]);

  // Which teams have a live game (drives the header pill + fixture pulses).
  const liveUserIds = useMemo(() => {
    const ids = [];
    Object.keys(USER_NAMES).forEach((uid) => {
      const ts = getTeamScores(uid);
      if (ts && ((ts.positionScores || []).some((p) => p.isGameLive) || (ts.benchScores || []).some((b) => b.isGameLive))) {
        ids.push(String(uid));
      }
    });
    return ids;
  }, [getTeamScores, allTeamScores]);
  const liveCount = liveUserIds.length;

  // Function to sort and arrange team cards
  const getTeamCardsOrder = () => {
    if (orderedFixtures && orderedFixtures.length > 0) {
      return orderedFixtures.flatMap((fixture) => {
        const homeUserId = fixture.home?.toString();
        const awayUserId = fixture.away?.toString();

        if (!homeUserId || !awayUserId ||
            homeUserId === 'TBD' || awayUserId === 'TBD' ||
            isNaN(Number(homeUserId)) || isNaN(Number(awayUserId))) {
          return [];
        }

        if (selectedUserId && (homeUserId === selectedUserId || awayUserId === selectedUserId)) {
          if (homeUserId === selectedUserId) {
            return [homeUserId, awayUserId];
          } else {
            return [awayUserId, homeUserId];
          }
        }

        return [homeUserId, awayUserId];
      });
    } else {
      return [...Object.keys(USER_NAMES)].sort((a, b) => {
        if (a === selectedUserId) return -1;
        if (b === selectedUserId) return 1;

        const scoreA = allTeamScores.find(s => s?.userId === a)?.totalScore || 0;
        const scoreB = allTeamScores.find(s => s?.userId === b)?.totalScore || 0;
        return scoreB - scoreA;
      });
    }
  };

  // Show progressive loading UI
  if (loading) {
    return (
      <div className="p-4 sm:p-6 w-full mx-auto">
        {/* Keep the scoreboard banner during load so the theme never swaps */}
        <div className="hidden sm:block mb-6 rounded-[22px] bg-gradient-to-br from-slate-900 via-slate-800 to-[#0b1120] px-[30px] py-[26px] text-white shadow-[0_18px_40px_-22px_rgba(15,23,42,0.55)]">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-400">
            {displayRoundName(displayedRound)} · {selectedYear} Season
          </div>
          <h1 className="text-[40px] font-black leading-none tracking-[-0.03em]">Team Scores</h1>
        </div>
        <div role="status" className="flex flex-col items-center py-8 text-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-lg font-medium text-slate-900">{loadingMessage || 'Loading...'}</span>
          
          {/* Progress indicators */}
          <div className="mt-6 flex justify-center items-center space-x-4">
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full transition-colors duration-300 ${
                loadingStage === 'round' || loadingStage === 'fixtures' || loadingStage === 'results' || loadingStage === 'complete' 
                  ? 'bg-blue-500' : 'bg-slate-200'
              }`}></div>
              <span className="text-xs mt-1 text-slate-500">Round</span>
            </div>
            <div className={`h-0.5 w-8 transition-colors duration-300 ${
              loadingStage === 'fixtures' || loadingStage === 'results' || loadingStage === 'complete'
                ? 'bg-blue-500' : 'bg-slate-200'
            }`}></div>
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full transition-colors duration-300 ${
                loadingStage === 'fixtures' || loadingStage === 'results' || loadingStage === 'complete'
                  ? 'bg-blue-500' : 'bg-slate-200'
              }`}></div>
              <span className="text-xs mt-1 text-slate-500">Fixtures</span>
            </div>
            <div className={`h-0.5 w-8 transition-colors duration-300 ${
              loadingStage === 'results' || loadingStage === 'complete'
                ? 'bg-blue-500' : 'bg-slate-200'
            }`}></div>
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full transition-colors duration-300 ${
                loadingStage === 'results' || loadingStage === 'complete'
                  ? 'bg-blue-500' : 'bg-slate-200'
              }`}></div>
              <span className="text-xs mt-1 text-slate-500">Results</span>
            </div>
          </div>
          
          {/* Stage-specific details */}
          <div className="mt-4 text-sm text-slate-400">
            {loadingStage === 'round' && 'Setting up round information...'}
            {loadingStage === 'fixtures' && 'Loading match fixtures...'}
            {loadingStage === 'results' && 'Calculating team scores and standings...'}
          </div>
        </div>
      </div>
    );
  }
  
  if (error) return (
    <div className="p-4 bg-red-50 border border-red-300 rounded-lg text-red-700">
      <h3 className="font-bold text-lg mb-2">Error Loading Data</h3>
      <p>{error}</p>
      <button 
        onClick={() => window.location.reload()}
        className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
      >
        Refresh Page
      </button>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      {/* Desktop scoreboard header */}
      <div className="hidden sm:block mb-6 rounded-[22px] bg-gradient-to-br from-slate-900 via-slate-800 to-[#0b1120] px-[30px] py-[26px] text-white shadow-[0_18px_40px_-22px_rgba(15,23,42,0.55)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          {/* Left: titles */}
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-400">
              {displayRoundName(displayedRound)} · {selectedYear} Season
            </div>
            <h1 className="text-[40px] font-black leading-none tracking-[-0.03em]">Team Scores</h1>
            <div className="mt-[14px] flex flex-wrap items-center gap-[14px]">
              <span className="text-[13px] text-slate-400">
                {roundInfo?.isLocked
                  ? <>Lockout <span className="font-semibold text-slate-200">passed</span></>
                  : roundInfo?.lockoutTime
                    ? <>Lockout <span className="font-semibold text-slate-200">{roundInfo.lockoutTime}</span></>
                    : null}
                {roundEndPassed ? ' · reserves unlocked' : ''}
              </span>
            </div>
          </div>

          {/* Right: controls + stat tiles */}
          <div className="flex flex-col items-end gap-4">
            <div className="flex items-center gap-[10px]">
              {isLoggedIn && (
                <select
                  id="round-select"
                  value={displayedRound || ''}
                  onChange={handleRoundChange}
                  className="cursor-pointer rounded-[11px] border border-white/[0.16] bg-white/[0.07] px-[13px] py-[9px] text-sm font-semibold text-slate-200"
                >
                  {[...Array(25)].map((_, i) => (
                    <option key={i} value={i} className="text-slate-900">
                      {displayRoundName(i)}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={refresh}
                disabled={isRefreshing}
                title="Refresh live scores"
                className="inline-flex items-center gap-2 rounded-[11px] border border-white/[0.16] bg-white/[0.07] px-[13px] py-[9px] text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.12] disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
            <div className="flex gap-[10px]">
              {[
                { label: '⭐ Top Score', value: headerStats.top, sub: headerStats.topName },
                { label: 'Average', value: headerStats.avg, sub: '8 teams' },
                { label: '🦀 Wooden Spoon', value: headerStats.low, sub: headerStats.lowName },
              ].map((tile) => (
                <div key={tile.label} className="min-w-[92px] rounded-[13px] border border-white/10 bg-white/[0.06] px-4 py-[10px]">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{tile.label}</div>
                  <div className="mt-[3px] text-2xl font-extrabold tracking-[-0.02em] tabular-nums">{tile.value}</div>
                  <div className="max-w-[96px] truncate text-[11px] text-slate-400">{tile.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Background refresh indicator */}
      {isRefreshing && (
        <div className="flex items-center gap-2 text-sm text-blue-600 mb-3 px-1">
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Updating scores...
        </div>
      )}

      {/* Enhanced Round Summary Section — desktop only (mobile has its own
          "The Round" tab in the live scoreboard below) */}
      <div className="hidden sm:block">
        <EnhancedRoundSummary
          displayedRound={displayedRound}
          roundName={displayRoundName(displayedRound)}
          orderedFixtures={orderedFixtures}
          allTeamScores={allTeamScores}
          selectedUserId={selectedUserId}
          hasSubstitutions={hasSubstitutions}
          isFinals={isFinalRound(displayedRound)}
          liveUserIds={liveUserIds}
          onTeamOpen={(uid) => setOpenCards((p) => ({ ...p, [uid]: true }))}
        />
      </div>

      {/* Mobile live scoreboard — replaces the old 2-col card grid on phones */}
      {!loading && (
        <MobileLiveScoreboard
          selectedUserId={selectedUserId}
          opponentId={opponentId}
          getTeamScores={getTeamScores}
          orderedFixtures={orderedFixtures}
          liveUserIds={liveUserIds}
          roundEndPassed={roundEndPassed}
          displayedRound={displayedRound}
          displayRoundName={displayRoundName}
          year={selectedYear}
          isLoggedIn={isLoggedIn}
          onRoundChange={handleRoundChange}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
        />
      )}

      {/* Desktop Team Cards Section - Original layout */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {getTeamCardsOrder().map(userId => {
            if (!userId || !USER_NAMES[userId]) return null;
            
            const userTeamScores = getTeamScores(userId);
            
            // Don't render if scores aren't calculated yet (prevents flashing)
            if (!userTeamScores || loading) {
              return (
                <div key={userId} id={`team-card-${userId}`} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-4 scroll-mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900">{USER_NAMES[userId]}</h2>
                    <div className="text-right font-bold text-lg text-slate-400">
                      Final Total: Loading...
                    </div>
                  </div>
                </div>
              );
            }
            
            const isUserTeam = String(userId) === String(selectedUserId);
            // Your team and your opponent's team are always expanded (no collapse).
            const forceOpen = isUserTeam || String(userId) === String(opponentId);
            return (
              <TeamScoreCard
                key={userId}
                userId={userId}
                userName={USER_NAMES[userId]}
                teamScores={userTeamScores}
                isHighestScore={userTeamScores.finalScore === highestScore && highestScore > 0}
                isLowestScore={userTeamScores.finalScore === lowestScore && lowestScore > 0}
                isUserTeam={isUserTeam}
                isRoundComplete={roundEndPassed}
                rank={rankMap[userId]}
                isOpen={!!openCards[userId] || forceOpen}
                collapsible={!forceOpen}
                onToggle={() => toggleCard(userId)}
              />
            );
          })}
        </div>
      </div>

      {/* Reserve players status (regular rounds) — kept at the bottom */}
      {displayedRound >= 1 && !isFinalRound(displayedRound) && (
        <div className={`mt-6 rounded-xl border p-3 text-sm ${roundEndPassed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <span className="font-semibold">Reserve Players:</span> {roundEndPassed ? 'Available' : 'Locked'}
          {!roundEndPassed && ' — available after the round ends'}
          <div className="mt-1 text-slate-600">
            <span className="font-semibold">Note:</span> Bench players with correct backup positions are always available for substitution.
          </div>
        </div>
      )}
    </div>
  );
}


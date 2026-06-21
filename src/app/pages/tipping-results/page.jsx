"use client";

import React, { useState, useEffect } from 'react';
import { USER_NAMES, TEAM_LOGOS, CURRENT_YEAR } from '@/app/lib/constants';
import { useAppContext } from '@/app/context/AppContext';
import { useUserContext } from '../layout';
import ScoreboardHeader from '@/app/components/ScoreboardHeader';

const TippingResultsGrid = () => {
  const { currentRound, roundInfo, getSpecificRoundInfo, selectedYear, fixtures: appFixtures } = useAppContext();
  const { selectedUserId } = useUserContext();
  const [selectedRound, setSelectedRound] = useState(null);
  const [fixtures, setFixtures] = useState([]);
  const [allUserTips, setAllUserTips] = useState({});
  const [yearTotals, setYearTotals] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedRoundInfo, setSelectedRoundInfo] = useState(null);
  const [isLockoutPassed, setIsLockoutPassed] = useState(false);

  // Mobile view states
  const [isMobile, setIsMobile] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  // Which mobile tab is showing. Lives here (not in the child) so it survives the
  // loading→loaded remount that happens on every round change. Defaults to Fixtures.
  const [mobileTab, setMobileTab] = useState('fixtures');

  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update selectedRound when currentRound changes
  useEffect(() => {
    if (currentRound !== null) {
      setSelectedRound(currentRound.toString());
    }
  }, [currentRound]);
  
  // Get round info for the selected round
  useEffect(() => {
    if (!selectedRound) return;
    if (getSpecificRoundInfo) {
      const roundInfo = getSpecificRoundInfo(parseInt(selectedRound));
      setSelectedRoundInfo(roundInfo);
      
      // Check if lockout has passed for this round
      const now = new Date();
      const lockoutDate = roundInfo?.lockoutDate;
      
      // Consider the lockout passed if:
      // 1. There's no lockout date (safety check)
      // 2. Current time is past the lockout
      // 3. We're looking at an earlier round (historical data)
      const hasLockoutPassed = !lockoutDate || 
                              now > new Date(lockoutDate) || 
                              parseInt(selectedRound) < currentRound;
                              
      setIsLockoutPassed(hasLockoutPassed);
    }
  }, [selectedRound, getSpecificRoundInfo, currentRound]);

  useEffect(() => {
    const loadAllResults = async () => {
      if (!selectedRound) return;
      setLoading(true);
      setError(null);

      try {
        // Use fixtures already loaded by AppContext — no extra fetch needed
        const roundFixtures = (appFixtures || [])
          .filter(f => f.RoundNumber.toString() === selectedRound)
          .sort((a, b) => a.MatchNumber - b.MatchNumber);
        setFixtures(roundFixtures);

        // Single API call for all users (replaces 16 separate requests)
        const response = await fetch(
          `/api/tipping-results-all?round=${selectedRound}&year=${selectedYear}`
        );
        if (!response.ok) throw new Error('Failed to load results');
        const data = await response.json();

        const tipsMap = {};
        const yearTotalsMap = {};

        Object.keys(USER_NAMES).forEach(userId => {
          const userData = data.users?.[userId] || {};
          const roundData = userData.round || {};
          const yearData = userData.year || {};

          const processedMatches = (roundData.matches || []).map(match => {
            if (!match.tip) {
              return { ...match, tip: match.homeTeam, isDefault: true };
            }
            return match;
          });

          tipsMap[userId] = {
            matches: processedMatches,
            correctTips: roundData.correctTips,
            deadCertScore: roundData.deadCertScore,
            totalScore: roundData.totalScore,
          };

          yearTotalsMap[userId] = {
            correctTips: yearData.correctTips,
            deadCertScore: yearData.deadCertScore,
          };
        });

        setAllUserTips(tipsMap);
        setYearTotals(yearTotalsMap);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadAllResults();
  }, [selectedRound, selectedYear, appFixtures]);

  const displayRound = (round) => {
    return round === '0' ? 'Opening Round' : `Round ${round}`;
  };

  const getWinningTeam = (fixture) => {
    if (fixture.HomeTeamScore === null || fixture.AwayTeamScore === null) return null;
    if (fixture.HomeTeamScore > fixture.AwayTeamScore) return fixture.HomeTeam;
    if (fixture.AwayTeamScore > fixture.HomeTeamScore) return fixture.AwayTeam;
    return 'Draw';
  };
  
  // Function to convert team names to abbreviations
  const getTeamAbbreviation = (teamName) => {
    if (!teamName) return '';
    
    // Common AFL team abbreviations
    const abbreviations = {
      'Adelaide': 'ADE',
      'Brisbane Lions': 'BRL',
      'Brisbane': 'BRL',
      'Carlton': 'CAR',
      'Collingwood': 'COL',
      'Essendon': 'ESS',
      'Fremantle': 'FRE',
      'Geelong': 'GEE',
      'Gold Coast': 'GCS',
      'Greater Western Sydney': 'GWS',
      'GWS Giants': 'GWS',
      'Hawthorn': 'HAW',
      'Melbourne': 'MEL',
      'North Melbourne': 'NTH',
      'Port Adelaide': 'PTA',
      'Richmond': 'RIC',
      'St Kilda': 'STK',
      'Sydney': 'SYD',
      'West Coast': 'WCE',
      'Western Bulldogs': 'WBD',
      'Bulldogs': 'WBD'
    };
    
    // Try to find the exact match first
    if (abbreviations[teamName]) {
      return abbreviations[teamName];
    }
    
    // If no exact match, try to find a partial match
    for (const [team, abbr] of Object.entries(abbreviations)) {
      if (teamName.includes(team)) {
        return abbr;
      }
    }
    
    // If no match found, return the first 3 letters
    return teamName.substring(0, 3).toUpperCase();
  };

  // Get sorted users for leaderboard
  const getSortedUsers = () => {
    return Object.entries(USER_NAMES)
      .sort((a, b) => {
        // Sort by year tips (highest first)
        const aTips = yearTotals[a[0]]?.correctTips || 0;
        const bTips = yearTotals[b[0]]?.correctTips || 0;
        
        // If tied on correctTips, sort by deadCertScore
        if (bTips === aTips) {
          return (yearTotals[b[0]]?.deadCertScore || 0) - (yearTotals[a[0]]?.deadCertScore || 0);
        }
        
        return bTips - aTips;
      });
  };

  if (loading) return (
    <div className="p-4 sm:p-8 text-center">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto mb-4"></div>
      Loading results...
    </div>
  );
  
  if (error) return (
    <div className="p-4 sm:p-8 text-center text-red-600">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
        Error: {error}
      </div>
    </div>
  );

  return (
    <div className="w-full">
      {/* Mobile View */}
      <div className="block md:hidden">
        <MobileTippingResults
          meId={selectedUserId}
          selectedRound={selectedRound}
          setSelectedRound={setSelectedRound}
          displayRound={displayRound}
          selectedRoundInfo={selectedRoundInfo}
          isLockoutPassed={isLockoutPassed}
          fixtures={fixtures}
          allUserTips={allUserTips}
          yearTotals={yearTotals}
          getTeamAbbreviation={getTeamAbbreviation}
          getWinningTeam={getWinningTeam}
          tab={mobileTab}
          setTab={setMobileTab}
          currentRound={currentRound}
        />
      </div>

      {/* Desktop View */}
      <div className="hidden md:block">
        <DesktopTippingResults 
          selectedRound={selectedRound}
          setSelectedRound={setSelectedRound}
          displayRound={displayRound}
          selectedRoundInfo={selectedRoundInfo}
          isLockoutPassed={isLockoutPassed}
          fixtures={fixtures}
          allUserTips={allUserTips}
          yearTotals={yearTotals}
          getSortedUsers={getSortedUsers}
          getTeamAbbreviation={getTeamAbbreviation}
          getWinningTeam={getWinningTeam}
          currentRound={currentRound}
        />
      </div>
    </div>
  );
};

// ---- Mobile helpers ---------------------------------------------------------

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Per-round dead-cert record (hits–misses) from a user's match list
function dcRecord(matches = []) {
  let good = 0, bad = 0;
  matches.forEach((m) => {
    if (m.deadCert) {
      if (m.correct === true) good++;
      else if (m.correct === false) bad++;
    }
  });
  return { good, bad };
}

// Round standings: round tips desc → net DC → season tips
function rankUsers(allUserTips, yearTotals) {
  return Object.keys(USER_NAMES).sort((a, b) => {
    const at = allUserTips[a]?.correctTips || 0, bt = allUserTips[b]?.correctTips || 0;
    if (bt !== at) return bt - at;
    const ad = allUserTips[a]?.deadCertScore || 0, bd = allUserTips[b]?.deadCertScore || 0;
    if (bd !== ad) return bd - ad;
    return (yearTotals[b]?.correctTips || 0) - (yearTotals[a]?.correctTips || 0);
  });
}

// The exact sort key a user is ranked on — used to give tied users the same rank
const rankKey = (uid, allUserTips, yearTotals) =>
  `${allUserTips[uid]?.correctTips || 0}|${allUserTips[uid]?.deadCertScore || 0}|${yearTotals[uid]?.correctTips || 0}`;

// Standard competition ranking ("1224"): users with identical sort keys share a rank
function computeRanks(rankedIds, keyFor) {
  const rankOf = {};
  let prevKey = null, prevRank = 0;
  rankedIds.forEach((uid, i) => {
    const k = keyFor(uid);
    if (prevKey !== null && k === prevKey) {
      rankOf[uid] = prevRank;
    } else {
      rankOf[uid] = i + 1;
      prevRank = i + 1;
      prevKey = k;
    }
  });
  return rankOf;
}

// A game in this list has started but has no final score yet
function hasLiveGame(fixtures = []) {
  return fixtures.some((f) => {
    const completed = f.HomeTeamScore !== null && f.AwayTeamScore !== null;
    const started = f.DateUtc ? new Date() >= new Date(f.DateUtc) : false;
    return started && !completed;
  });
}

// A game in this list has a final score
function hasCompletedGame(fixtures = []) {
  return fixtures.some((f) => f.HomeTeamScore !== null && f.AwayTeamScore !== null);
}

// One stat in the dark header's summary row — label and value each carry their own colour
function HeaderStat({ label, labelClass = 'text-slate-400', value, valueClass = 'text-slate-200' }) {
  return (
    <div className="flex-1 text-center">
      <div className={`text-[8px] font-extrabold uppercase tracking-[0.08em] ${labelClass}`}>{label}</div>
      <div className={`mt-0.5 text-[14px] font-extrabold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

// Mobile Component — redesigned "Tip Results" matching the live scoreboard theme
function MobileTippingResults({
  meId,
  selectedRound,
  setSelectedRound,
  displayRound,
  selectedRoundInfo,
  isLockoutPassed,
  fixtures,
  allUserTips,
  yearTotals,
  getTeamAbbreviation,
  getWinningTeam,
  tab,
  setTab,
  currentRound
}) {
  const totalGames = fixtures.length;
  const ranked = rankUsers(allUserTips, yearTotals);
  // Competition ranking so users tied on every key share a rank (no fake 1st/2nd split)
  const rankOf = computeRanks(ranked, (uid) => rankKey(uid, allUserTips, yearTotals));

  // A game in this round is currently underway → show the LIVE pill in the header
  const anyLive = hasLiveGame(fixtures);
  // Whether the round has any results yet — gates the "Nth this round" rank label
  const hasResults = hasCompletedGame(fixtures);

  // "You" hero — only when a real team (not admin / guest) is selected
  const showHero = meId && meId !== 'admin' && USER_NAMES[meId];
  const meRoundTips = allUserTips[meId]?.correctTips || 0;
  const meNet = allUserTips[meId]?.deadCertScore || 0;
  const meDC = dcRecord(allUserTips[meId]?.matches);
  const meSeason = yearTotals[meId]?.correctTips || 0;

  const tabBtn = (key, label) => (
    <button
      onClick={() => setTab(key)}
      className={`flex-1 rounded-[10px] py-2.5 text-[12px] font-extrabold transition-colors ${
        tab === key ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-500'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="px-4 pb-10 pt-2 text-slate-700">
      {/* Dark scoreboard header with the round summary embedded inside it */}
      <div className="rounded-[20px] bg-gradient-to-br from-slate-900 via-slate-800 to-[#0b1120] p-4 pb-[15px] text-white shadow-[0_16px_34px_-20px_rgba(15,23,42,0.6)]">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-400">
              {displayRound(selectedRound)} · Tipping
            </div>
            <h1 className="mt-[3px] text-[26px] font-black leading-none tracking-[-0.03em] text-white">Tip Results</h1>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {anyLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(251,191,36,0.32)] bg-[rgba(217,119,6,0.16)] px-2.5 py-1 text-[10px] font-extrabold tracking-[0.04em] text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse-dot" />
                LIVE
              </span>
            )}
            <select
              value={selectedRound}
              onChange={(e) => setSelectedRound(e.target.value)}
              className="dz-select-dark text-sm"
            >
              {Array.from({ length: 25 }, (_, i) => (
                <option key={i} value={i.toString()}>
                  {displayRound(i.toString())}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Your round summary */}
        {showHero && (
          <div className="mt-[15px] rounded-[14px] border border-[rgba(96,165,250,0.28)] bg-[rgba(59,130,246,0.12)] p-3">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="text-[23px] leading-none">{TEAM_LOGOS[meId]}</span>
                <div className="min-w-0">
                  <div className="max-w-[150px] truncate text-[13px] font-extrabold text-white">{USER_NAMES[meId]}</div>
                  <div className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-blue-300">
                    {hasResults ? `You · ${ordinal(rankOf[meId])} this round` : 'You'}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[30px] font-black leading-none tabular-nums text-white">
                  {meRoundTips}<span className="text-[15px] font-bold text-blue-300"> / {totalGames}</span>
                </div>
                <div className="mt-0.5 text-[8px] font-extrabold uppercase tracking-[0.1em] text-blue-300">Correct</div>
              </div>
            </div>
            <div className="mt-[11px] flex border-t border-white/10 pt-2.5">
              <HeaderStat label="Dead Certs" labelClass="text-slate-500" value={`${meDC.good}–${meDC.bad}`} valueClass="text-slate-200" />
              <div className="w-px bg-white/10" />
              <HeaderStat label="Net DC" labelClass="text-emerald-300" value={meNet > 0 ? `+${meNet}` : `${meNet}`} valueClass={meNet > 0 ? 'text-emerald-300' : meNet < 0 ? 'text-red-300' : 'text-slate-200'} />
              <div className="w-px bg-white/10" />
              <HeaderStat label="Season" labelClass="text-blue-300" value={meSeason} valueClass="text-blue-300 font-black" />
            </div>
          </div>
        )}
      </div>

      {/* Tips hidden until lockout */}
      {!isLockoutPassed && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          🔒 Tips lock at <span className="font-semibold">{selectedRoundInfo?.lockoutTime || '—'}</span>. Everyone&apos;s picks are hidden until then.
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 mt-4 flex gap-1 rounded-[13px] border border-slate-200 bg-white p-1 shadow-sm">
        {tabBtn('fixtures', 'Fixtures & Tips')}
        {tabBtn('standings', 'Round Standings')}
      </div>

      {tab === 'fixtures' && (
        <MobileFixtures
          meId={meId}
          fixtures={fixtures}
          allUserTips={allUserTips}
          getTeamAbbreviation={getTeamAbbreviation}
          getWinningTeam={getWinningTeam}
          isLockoutPassed={isLockoutPassed}
        />
      )}

      {tab === 'standings' && (
        <MobileStandings
          meId={meId}
          ranked={ranked}
          rankOf={rankOf}
          allUserTips={allUserTips}
          yearTotals={yearTotals}
          totalGames={totalGames}
        />
      )}
    </div>
  );
}

// A single home/away line inside a fixture card
function TeamLine({ abbr, name, score, win, completed }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-11 shrink-0 rounded-md border py-1 text-center text-[11px] font-extrabold ${
        win ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-100 text-slate-600'
      }`}>
        {abbr}
      </div>
      <span className={`min-w-0 flex-1 truncate text-[13px] ${win ? 'font-bold text-slate-900' : 'font-medium text-slate-500'}`}>
        {name}
      </span>
      <span className={`text-[18px] font-extrabold tabular-nums ${win ? 'text-emerald-600' : completed ? 'text-slate-400' : 'text-slate-300'}`}>
        {score ?? '-'}
      </span>
    </div>
  );
}

// Mobile Fixtures — every team's tip per game, with ✓/✗ and dead-cert badges
function MobileFixtures({ meId, fixtures, allUserTips, getTeamAbbreviation, getWinningTeam, isLockoutPassed }) {
  const userIds = Object.keys(USER_NAMES);

  return (
    <div className="flex flex-col gap-2.5">
      {fixtures.map((fixture) => {
        const completed = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
        const started = fixture.DateUtc ? new Date() >= new Date(fixture.DateUtc) : false;
        const live = started && !completed;
        const winner = completed ? getWinningTeam(fixture) : null;
        const hWin = completed && winner === fixture.HomeTeam;
        const aWin = completed && winner === fixture.AwayTeam;

        let homeCount = 0, awayCount = 0;
        const rows = userIds.map((uid) => {
          const m = allUserTips[uid]?.matches?.find((x) => x.matchNumber === fixture.MatchNumber);
          if (m?.tip === fixture.HomeTeam) homeCount++;
          else if (m?.tip === fixture.AwayTeam) awayCount++;
          return { uid, m };
        });

        return (
          <div
            key={fixture.MatchNumber}
            className={`rounded-[15px] border bg-white p-3.5 ${
              live ? 'border-amber-200 shadow-[0_0_0_3px_rgba(217,119,6,0.06)]' : 'border-slate-200 shadow-sm'
            }`}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <span className={`text-[10px] font-extrabold uppercase tracking-[0.1em] ${live ? 'text-amber-600' : 'text-slate-400'}`}>
                Game {fixture.MatchNumber}
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] ${
                live ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : completed ? 'border-slate-200 bg-slate-100 text-slate-500'
                  : 'border-blue-200 bg-blue-50 text-blue-600'
              }`}>
                {live ? 'Live' : completed ? 'Final' : 'Upcoming'}
              </span>
            </div>

            <TeamLine abbr={getTeamAbbreviation(fixture.HomeTeam)} name={fixture.HomeTeam} score={fixture.HomeTeamScore} win={hWin} completed={completed} />
            <div className="my-1.5 h-px bg-slate-100" />
            <TeamLine abbr={getTeamAbbreviation(fixture.AwayTeam)} name={fixture.AwayTeam} score={fixture.AwayTeamScore} win={aWin} completed={completed} />

            {isLockoutPassed ? (
              <>
                <div className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold tabular-nums text-slate-500">
                  {homeCount} tipped {getTeamAbbreviation(fixture.HomeTeam)} · {awayCount} tipped {getTeamAbbreviation(fixture.AwayTeam)}
                </div>

                <div className="mt-2 flex flex-col gap-0.5">
                  {rows.map(({ uid, m }) => {
                    const isMe = String(uid) === String(meId);
                    const correct = m?.correct;
                    // No real tip submitted — the app auto-defaults to the home team. Show it
                    // muted with a "def" marker so it doesn't read as a deliberate (correct) pick.
                    const isDefault = m?.isDefault;
                    const tipColor = isDefault
                      ? 'italic text-slate-400'
                      : correct === true ? 'text-emerald-600' : correct === false ? 'text-red-600' : 'text-slate-500';
                    const icon = !isDefault && correct === true ? '✓' : !isDefault && correct === false ? '✗' : '';
                    let badge = null;
                    if (m?.deadCert) {
                      if (correct === true) badge = { t: '+6', c: 'border-emerald-200 bg-emerald-50 text-emerald-600' };
                      else if (correct === false) badge = { t: '-12', c: 'border-red-200 bg-red-50 text-red-600' };
                      else badge = { t: 'DC', c: 'border-amber-200 bg-amber-50 text-amber-600' };
                    }
                    return (
                      <div key={uid} className={`grid grid-cols-[1fr_auto_42px] items-center gap-2 rounded-md px-1.5 py-1 ${isMe ? 'bg-blue-50' : ''}`}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="text-[13px] leading-none">{TEAM_LOGOS[uid]}</span>
                          <span className={`truncate text-[12px] ${isMe ? 'font-extrabold text-blue-700' : 'font-semibold text-slate-600'}`}>
                            {USER_NAMES[uid]}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={`text-[12px] font-extrabold ${tipColor}`}>{m?.tip ? getTeamAbbreviation(m.tip) : '-'}</span>
                          {isDefault
                            ? <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">def</span>
                            : <span className={`w-2.5 text-center text-[11px] font-extrabold ${correct === true ? 'text-emerald-600' : 'text-red-600'}`}>{icon}</span>}
                        </div>
                        {badge
                          ? <span className={`justify-self-end rounded-full border px-1.5 py-px text-[9px] font-extrabold tabular-nums ${badge.c}`}>{badge.t}</span>
                          : <span />}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="mt-2.5 text-center text-[11px] italic text-slate-400">Tips hidden until lockout</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Mobile Standings — round tips with a net-DC tiebreak, plus scoring legend
function MobileStandings({ meId, ranked, rankOf, allUserTips, yearTotals, totalGames }) {
  const legend = (cls, label, value, valueCls) => (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${cls}`}>
      {label} <strong className={valueCls}>{value}</strong>
    </span>
  );

  return (
    <div>
      <div className="mb-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
        Ranked by round tips · Net DC tiebreak
      </div>
      <div className="overflow-hidden rounded-[16px] border border-slate-200 bg-white shadow-sm">
        {ranked.map((uid, i) => {
          const isMe = String(uid) === String(meId);
          const rank = rankOf?.[uid] ?? i + 1;
          const isLeader = rank === 1;
          const roundTips = allUserTips[uid]?.correctTips || 0;
          const net = allUserTips[uid]?.deadCertScore || 0;
          const season = yearTotals[uid]?.correctTips || 0;
          return (
            <div key={uid} className={`flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 ${isMe ? 'bg-blue-50' : ''}`}>
              <span className={`w-5 text-center text-[13px] font-black tabular-nums ${isLeader ? 'text-amber-600' : 'text-slate-400'}`}>{rank}</span>
              <span className="text-base leading-none">{TEAM_LOGOS[uid]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`truncate text-[13px] ${isMe ? 'font-extrabold text-slate-900' : 'font-bold text-slate-700'}`}>{USER_NAMES[uid]}</span>
                  {isMe && <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-px text-[8px] font-extrabold tracking-[0.08em] text-blue-700">YOU</span>}
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums text-slate-400">
                  Season {season} · <span className={net >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>{net >= 0 ? '+' : ''}{net} DC</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className={`text-[20px] font-black tabular-nums ${isLeader ? 'text-amber-600' : isMe ? 'text-blue-600' : 'text-slate-900'}`}>{roundTips}</span>
                <span className="text-[11px] font-bold text-slate-300"> / {totalGames}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        {legend('border-slate-200 bg-slate-100 text-slate-600', 'Correct tip', '+1', 'text-slate-900')}
        {legend('border-emerald-200 bg-emerald-50 text-slate-600', 'DC hit', '+6', 'text-emerald-600')}
        {legend('border-red-200 bg-red-50 text-slate-600', 'DC miss', '−12', 'text-red-600')}
      </div>
    </div>
  );
}

// Mobile Individual Tips Component
function MobileIndividualTips({ 
  getSortedUsers, 
  selectedUser, 
  setSelectedUser, 
  allUserTips, 
  fixtures, 
  getTeamAbbreviation, 
  getWinningTeam, 
  isLockoutPassed 
}) {
  return (
    <div className="space-y-4">
      {/* User Selection */}
      <div className="dz-surface p-4">
        <label className="block text-sm font-medium text-slate-900 mb-2">Select Player:</label>
        <select
          value={selectedUser}
          onChange={(e) => setSelectedUser(e.target.value)}
          className="dz-select w-full"
        >
          <option value="">Choose a player</option>
          {getSortedUsers().map(([userId, userName]) => (
            <option key={userId} value={userId}>
              {userName}
            </option>
          ))}
        </select>
      </div>

      {/* Individual Tips */}
      {selectedUser && allUserTips[selectedUser] && (
        <div className="space-y-3">
          <div className="dz-surface p-4">
            <h3 className="font-semibold text-slate-900 mb-2">
              {USER_NAMES[selectedUser]}'s Tips
            </h3>
            <div className="text-sm text-slate-600">
              Round Score: {allUserTips[selectedUser]?.correctTips || 0}
              {allUserTips[selectedUser]?.deadCertScore !== 0 && (
                <span className={allUserTips[selectedUser]?.deadCertScore > 0 ? "text-emerald-600" : "text-red-600"}>
                  {allUserTips[selectedUser]?.deadCertScore > 0 ? " +" : " "}{allUserTips[selectedUser]?.deadCertScore || 0}
                </span>
              )}
            </div>
          </div>

          {fixtures.map(fixture => {
            const matchTip = allUserTips[selectedUser]?.matches?.find(m => m.matchNumber === fixture.MatchNumber);
            const isCorrect = matchTip?.correct;
            const isDeadCert = matchTip?.deadCert;
            const isDefault = matchTip?.isDefault;
            const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
            
            return (
              <div key={fixture.MatchNumber} className="dz-surface p-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-sm text-slate-600">Game {fixture.MatchNumber}</div>
                  {isDeadCert && (
                    <div className={`text-xs px-2 py-1 rounded ${
                      isMatchCompleted ?
                        (isCorrect ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800') :
                        'bg-yellow-100 text-yellow-800'
                    }`}>
                      {isMatchCompleted ? 
                        (isCorrect ? '+6' : '-12') :
                        'DC'
                      }
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-3 gap-4 items-center">
                  {/* Home Team */}
                  <div className="text-center">
                    <div className={`font-medium ${
                      matchTip?.tip === fixture.HomeTeam ?
                        (isCorrect ? 'text-emerald-600' : isMatchCompleted ? 'text-red-600' : 'text-blue-600') :
                        (isMatchCompleted ? 'text-slate-900' : 'text-blue-600')
                    }`}>
                      {getTeamAbbreviation(fixture.HomeTeam)}
                      {matchTip?.tip === fixture.HomeTeam && (
                        <span className="ml-1 text-xs">
                          {isLockoutPassed ? '✓' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-500">HOME</div>
                    <div className="text-lg font-bold">
                      {fixture.HomeTeamScore ?? '-'}
                    </div>
                  </div>
                  
                  {/* VS */}
                  <div className="text-center">
                    <div className="text-slate-400 font-medium">VS</div>
                    {isLockoutPassed ? (
                      <div className="text-xs mt-1">
                        {matchTip?.tip ? (
                          <span className={`font-medium ${
                            isMatchCompleted ?
                              (isCorrect ? 'text-emerald-600' : 'text-red-600') :
                              (matchTip?.tip === fixture.HomeTeam ? 'text-blue-600' : 'text-slate-900')
                          }`}>
                            {getTeamAbbreviation(matchTip.tip)}
                            {isDefault && ' (Def)'}
                          </span>
                        ) : (
                          <span className="text-slate-500">No tip</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 mt-1">Locked</div>
                    )}
                  </div>
                  
                  {/* Away Team */}
                  <div className="text-center">
                    <div className={`font-medium ${
                      matchTip?.tip === fixture.AwayTeam ?
                        (isCorrect ? 'text-emerald-600' : isMatchCompleted ? 'text-red-600' : 'text-slate-900') :
                        (isMatchCompleted ? 'text-slate-900' : 'text-slate-900')
                    }`}>
                      {getTeamAbbreviation(fixture.AwayTeam)}
                      {matchTip?.tip === fixture.AwayTeam && (
                        <span className="ml-1 text-xs">
                          {isLockoutPassed ? '✓' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-500">AWAY</div>
                    <div className="text-lg font-bold">
                      {fixture.AwayTeamScore ?? '-'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Desktop Component (Original)
function DesktopTippingResults({
  selectedRound,
  setSelectedRound,
  displayRound,
  selectedRoundInfo,
  isLockoutPassed,
  fixtures,
  allUserTips,
  yearTotals,
  getSortedUsers,
  getTeamAbbreviation,
  getWinningTeam,
  currentRound
}) {
  const isCurrentRound = parseInt(selectedRound) === currentRound;
  
  return (
    <div className="container mx-auto px-4 py-8">
      <ScoreboardHeader
        eyebrow={displayRound(selectedRound)}
        title="Round Summary"
      >
        <select
          value={selectedRound}
          onChange={(e) => setSelectedRound(e.target.value)}
          className="dz-select-dark"
        >
          {Array.from({ length: 25 }, (_, i) => (
            <option key={i} value={i.toString()}>
              {displayRound(i.toString())}
            </option>
          ))}
        </select>
      </ScoreboardHeader>

      {/* Show lockout status */}
      {selectedRoundInfo && (
        <div className="mb-8 -mt-2 text-sm">
          <span className="font-medium">Lockout: </span>
          <span className={isLockoutPassed ? "text-emerald-600" : "text-red-600"}>
            {selectedRoundInfo.lockoutTime || "Not set"}
            {isLockoutPassed ? " (Passed)" : " (Not yet passed)"}
          </span>
          {!isLockoutPassed && (
            <span className="ml-2 text-slate-600">
              • Tips will be visible after lockout
            </span>
          )}
        </div>
      )}

      <div className="dz-surface overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="py-2 px-4 border border-slate-200 sticky left-0 bg-slate-100 z-10 text-slate-900" rowSpan={3}>Team</th>
              <th className="py-2 px-4 border border-slate-200 bg-slate-100 text-slate-900" rowSpan={3}>Total (Year) | (Round)</th>
              {fixtures.map(fixture => {
                const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;

                return (
                  <th key={fixture.MatchNumber} className={`py-1 px-2 border border-slate-200 text-center text-slate-900 ${isMatchCompleted ? 'bg-emerald-50' : 'bg-slate-100'}`}>
                    Game {fixture.MatchNumber}
                  </th>
                );
              })}
            </tr>
            <tr className="bg-slate-50">
              {fixtures.map(fixture => {
                const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;

                return (
                  <td key={`h-${fixture.MatchNumber}`} className={`py-1 px-2 border border-slate-200 text-center whitespace-nowrap ${
                    isMatchCompleted ? 'bg-emerald-50 text-slate-900' : 'bg-slate-50 text-blue-600'
                  }`}>
                    H - {getTeamAbbreviation(fixture.HomeTeam)} ({fixture.HomeTeamScore ?? '-'})
                  </td>
                );
              })}
            </tr>
            <tr className="bg-slate-50">
              {fixtures.map(fixture => {
                const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;

                return (
                  <td key={`a-${fixture.MatchNumber}`} className={`py-1 px-2 border border-slate-200 text-center whitespace-nowrap ${
                    isMatchCompleted ? 'bg-emerald-50 text-slate-900' : 'bg-slate-50 text-slate-900'
                  }`}>
                    A - {getTeamAbbreviation(fixture.AwayTeam)} ({fixture.AwayTeamScore ?? '-'})
                    <div className="text-xs font-medium">
                      {isMatchCompleted &&
                        <span className="text-emerald-600">W - {getTeamAbbreviation(getWinningTeam(fixture))}</span>
                      }
                    </div>
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {getSortedUsers().map(([userId, userName]) => {
              const userResults = allUserTips[userId];
              return (
                <tr key={userId} className="hover:bg-slate-50">
                  <td className="py-2 px-4 border border-slate-200 sticky left-0 bg-white z-10 font-medium text-slate-900">
                    {userName}
                  </td>
                  <td className="py-2 px-4 border border-slate-200 text-center font-medium">
                    <div className="flex flex-col sm:flex-row justify-center items-center gap-1">
                      <span className="text-slate-900">
                        {yearTotals[userId]?.correctTips || 0}
                      </span>
                      {yearTotals[userId]?.deadCertScore !== 0 && (
                        <span className={yearTotals[userId]?.deadCertScore > 0 ? "text-emerald-600" : "text-red-600"}>
                          ({yearTotals[userId]?.deadCertScore > 0 ? "+" : ""}{yearTotals[userId]?.deadCertScore || 0})
                        </span>
                      )}
                      <span className="text-slate-400 mx-1">|</span>
                      <span className="text-slate-700">
                        {isCurrentRound ? (
                          <>
                            {userResults?.correctTips || 0} Tips
                            {userResults?.deadCertScore !== 0 && (
                              <span className={userResults?.deadCertScore > 0 ? "text-emerald-600" : "text-red-600"}>
                                , {userResults?.deadCertScore > 0 ? "+" : ""}{userResults?.deadCertScore || 0} DCs
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {userResults?.correctTips || 0}
                            {userResults?.deadCertScore !== 0 && (
                              <span className={userResults?.deadCertScore > 0 ? "text-emerald-600" : "text-red-600"}>
                                ({userResults?.deadCertScore > 0 ? "+" : ""}{userResults?.deadCertScore || 0})
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  </td>
                  {fixtures.map(fixture => {
                    const matchTip = userResults?.matches?.find(m => m.matchNumber === fixture.MatchNumber);
                    const isCorrect = matchTip?.correct;
                    const isDeadCert = matchTip?.deadCert;
                    const isDefault = matchTip?.isDefault;
                    
                    // Determine if the match has been completed
                    const isMatchCompleted = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
                    
                    return (
                      <td key={fixture.MatchNumber} className="py-2 px-4 border border-slate-200 text-center">
                        <div
                          className={`
                            ${isMatchCompleted ?
                              (isCorrect ? 'text-emerald-600' : 'text-red-600') :
                              (matchTip?.tip === fixture.HomeTeam ? 'text-blue-600' : 'text-slate-900')
                            }
                            ${!matchTip?.tip ? 'text-slate-900' : ''}
                            ${isDefault ? 'italic text-slate-500' : 'font-medium'}
                          `}
                        >
                          {/* Check if lockout has passed before showing tips */}
                          {isLockoutPassed ? (
                            <>
                              {matchTip?.tip ? getTeamAbbreviation(matchTip.tip) : '-'}
                              {isDefault && <span className="ml-1">(Def)</span>}
                              {isDeadCert && (
                                <span className="ml-1 text-sm font-medium">
                                  {isMatchCompleted ?
                                    <span className={isCorrect ? 'text-emerald-600' : 'text-red-600'}>
                                      ({isCorrect ? '+6' : '-12'})
                                    </span> :
                                    <span className="text-yellow-600">(DC)</span>
                                  }
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-500 italic">Locked</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TippingResultsGrid;
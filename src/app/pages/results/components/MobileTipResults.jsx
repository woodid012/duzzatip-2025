'use client';

// Tip-results content for the mobile Round Results page. Self-contained: given a
// round it fetches every team's tips, then renders a "your tips" summary plus a
// Fixtures & Tips / Round Standings sub-toggle. Mirrors the standalone Tip Results
// mobile view but without its own dark header (the Round Results header owns the
// round selector + refresh).

import { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { USER_NAMES, TEAM_LOGOS } from '@/app/lib/constants';

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

// Round standings order: round tips desc → net DC → season tips
function rankUsers(allUserTips, yearTotals) {
  return Object.keys(USER_NAMES).sort((a, b) => {
    const at = allUserTips[a]?.correctTips || 0, bt = allUserTips[b]?.correctTips || 0;
    if (bt !== at) return bt - at;
    const ad = allUserTips[a]?.deadCertScore || 0, bd = allUserTips[b]?.deadCertScore || 0;
    if (bd !== ad) return bd - ad;
    return (yearTotals[b]?.correctTips || 0) - (yearTotals[a]?.correctTips || 0);
  });
}

const rankKey = (uid, allUserTips, yearTotals) =>
  `${allUserTips[uid]?.correctTips || 0}|${allUserTips[uid]?.deadCertScore || 0}|${yearTotals[uid]?.correctTips || 0}`;

// Standard competition ranking ("1224"): users tied on every key share a rank
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

const TEAM_ABBR = {
  'Adelaide': 'ADE', 'Brisbane Lions': 'BRL', 'Brisbane': 'BRL', 'Carlton': 'CAR',
  'Collingwood': 'COL', 'Essendon': 'ESS', 'Fremantle': 'FRE', 'Geelong': 'GEE',
  'Gold Coast': 'GCS', 'Greater Western Sydney': 'GWS', 'GWS Giants': 'GWS',
  'Hawthorn': 'HAW', 'Melbourne': 'MEL', 'North Melbourne': 'NTH', 'Port Adelaide': 'PTA',
  'Richmond': 'RIC', 'St Kilda': 'STK', 'Sydney': 'SYD', 'West Coast': 'WCE',
  'Western Bulldogs': 'WBD', 'Bulldogs': 'WBD',
};
function getTeamAbbreviation(teamName) {
  if (!teamName) return '';
  if (TEAM_ABBR[teamName]) return TEAM_ABBR[teamName];
  for (const [team, abbr] of Object.entries(TEAM_ABBR)) {
    if (teamName.includes(team)) return abbr;
  }
  return teamName.substring(0, 3).toUpperCase();
}
function getWinningTeam(fixture) {
  if (fixture.HomeTeamScore === null || fixture.AwayTeamScore === null) return null;
  if (fixture.HomeTeamScore > fixture.AwayTeamScore) return fixture.HomeTeam;
  if (fixture.AwayTeamScore > fixture.HomeTeamScore) return fixture.AwayTeam;
  return 'Draw';
}

function HeroStat({ label, value, accent = 'text-slate-900' }) {
  return (
    <div className="flex-1 text-center">
      <div className="text-[8px] font-extrabold uppercase tracking-[0.08em] text-slate-500">{label}</div>
      <div className={`mt-0.5 text-[14px] font-extrabold tabular-nums ${accent}`}>{value}</div>
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

export default function MobileTipResults({ round, meId, year }) {
  const { fixtures: appFixtures } = useAppContext();
  const [allUserTips, setAllUserTips] = useState({});
  const [yearTotals, setYearTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('fixtures');

  const roundStr = round != null ? round.toString() : null;

  // AFL games for this round (from the already-loaded fixtures)
  const fixtures = useMemo(
    () => (appFixtures || [])
      .filter((f) => f.RoundNumber?.toString() === roundStr)
      .sort((a, b) => a.MatchNumber - b.MatchNumber),
    [appFixtures, roundStr]
  );

  // Load every team's tips for the round
  useEffect(() => {
    if (roundStr == null) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tipping-results-all?round=${roundStr}&year=${year}`);
        if (!res.ok) throw new Error('Failed to load tips');
        const data = await res.json();
        const tipsMap = {}, yearMap = {};
        Object.keys(USER_NAMES).forEach((uid) => {
          const u = data.users?.[uid] || {};
          const r = u.round || {}, y = u.year || {};
          const matches = (r.matches || []).map((m) => (!m.tip ? { ...m, tip: m.homeTeam, isDefault: true } : m));
          tipsMap[uid] = { matches, correctTips: r.correctTips, deadCertScore: r.deadCertScore, totalScore: r.totalScore };
          yearMap[uid] = { correctTips: y.correctTips, deadCertScore: y.deadCertScore };
        });
        if (!cancelled) { setAllUserTips(tipsMap); setYearTotals(yearMap); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [roundStr, year]);

  const totalGames = fixtures.length;
  const lockoutPassed = fixtures.some((f) => f.DateUtc && new Date() >= new Date(f.DateUtc));
  const hasResults = fixtures.some((f) => f.HomeTeamScore !== null && f.AwayTeamScore !== null);

  const ranked = rankUsers(allUserTips, yearTotals);
  const rankOf = computeRanks(ranked, (uid) => rankKey(uid, allUserTips, yearTotals));

  const showHero = meId && meId !== 'admin' && USER_NAMES[meId];
  const meRoundTips = allUserTips[meId]?.correctTips || 0;
  const meNet = allUserTips[meId]?.deadCertScore || 0;
  const meDC = dcRecord(allUserTips[meId]?.matches);
  const meSeason = yearTotals[meId]?.correctTips || 0;

  const userIds = Object.keys(USER_NAMES);

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

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        Loading tips…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
        Couldn&apos;t load tips: {error}
      </div>
    );
  }

  return (
    <div>
      {/* Your tips summary */}
      {showHero && (
        <div className="mb-4 rounded-[22px] border border-blue-200 bg-blue-50 p-4 shadow-[0_10px_30px_-18px_rgba(37,99,235,0.45)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[24px] leading-none">{TEAM_LOGOS[meId]}</span>
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-900 truncate max-w-[160px]">{USER_NAMES[meId]}</div>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-blue-600">
                  {hasResults ? `You · ${ordinal(rankOf[meId])} this round` : 'Your tips'}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[30px] font-black leading-none tabular-nums text-slate-900">
                {meRoundTips}<span className="text-[15px] font-bold text-slate-400"> / {totalGames}</span>
              </div>
              <div className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Correct</div>
            </div>
          </div>
          <div className="mt-3 flex border-t border-blue-200/70 pt-2.5">
            <HeroStat label="Dead Certs" value={`${meDC.good}–${meDC.bad}`} />
            <div className="w-px bg-blue-200/70" />
            <HeroStat label="Net DC" value={meNet > 0 ? `+${meNet}` : `${meNet}`} accent={meNet > 0 ? 'text-emerald-600' : meNet < 0 ? 'text-red-600' : 'text-slate-900'} />
            <div className="w-px bg-blue-200/70" />
            <HeroStat label="Season" value={meSeason} accent="text-blue-600" />
          </div>
        </div>
      )}

      {/* Sub-toggle */}
      <div className="mb-4 flex gap-1 rounded-[13px] border border-slate-200 bg-slate-100 p-1">
        {tabBtn('fixtures', 'Fixtures & Tips')}
        {tabBtn('standings', 'Round Standings')}
      </div>

      {!lockoutPassed ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          🔒 Everyone&apos;s tips are hidden until the round locks in.
        </div>
      ) : tab === 'fixtures' ? (
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

                <div className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold tabular-nums text-slate-500">
                  {homeCount} tipped {getTeamAbbreviation(fixture.HomeTeam)} · {awayCount} tipped {getTeamAbbreviation(fixture.AwayTeam)}
                </div>

                <div className="mt-2 flex flex-col gap-0.5">
                  {rows.map(({ uid, m }) => {
                    const isMe = String(uid) === String(meId);
                    const correct = m?.correct;
                    // No real tip submitted — auto-defaulted to home; show muted with "def".
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
              </div>
            );
          })}
        </div>
      ) : (
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">Correct tip <strong className="text-slate-900">+1</strong></span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600">DC hit <strong className="text-emerald-600">+6</strong></span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600">DC miss <strong className="text-red-600">−12</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}

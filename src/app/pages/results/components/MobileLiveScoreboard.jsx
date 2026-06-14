'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { USER_NAMES, TEAM_LOGOS } from '@/app/lib/constants';

// Small pulsing dot used on live scores (green to flag a game in progress)
const LiveDot = ({ className = 'bg-emerald-500' }) => (
  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle animate-pulse ${className}`} />
);

// Bench + reserves, rendered inside the breakdown
function BenchList({ scores, roundEndPassed }) {
  const bench = scores.benchScores || [];
  if (bench.length === 0) return null;
  return (
    <div className="mt-3 rounded-[13px] border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Bench / Reserves</div>
      <div className="flex flex-col gap-0.5">
        {bench.map((b) => {
          const showDNP = roundEndPassed && !b.didPlay;
          const used = b.isBeingUsed;
          const live = b.isGameLive;
          const scoreColor = showDNP ? 'text-red-600' : used ? 'text-emerald-600' : live ? 'text-amber-600' : 'text-slate-500';
          const nameColor = used ? 'text-emerald-600' : showDNP ? 'text-red-600' : 'text-slate-700';
          // Which position(s) this bench/reserve covers — what it's "backing up".
          const backup = used
            ? `→ ${b.replacingPosition || 'in use'}`
            : b.position === 'Reserve A'
              ? 'FF · TF · RK'
              : b.position === 'Reserve B'
                ? 'OFF · MID · TAK'
                : (b.backupPosition || 'Utility');
          return (
            <div key={b.position} className={`grid grid-cols-[104px_1fr_44px] items-center gap-2 px-1.5 py-1 rounded-md ${live ? 'bg-amber-50' : ''}`}>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-slate-600 truncate">{b.position}</div>
                <div className={`text-[8px] font-semibold uppercase tracking-[0.02em] truncate ${used ? 'text-emerald-600' : 'text-slate-400'}`}>{backup}</div>
              </div>
              <div className="min-w-0">
                <div className={`text-[12px] font-semibold truncate ${nameColor}`}>
                  {b.playerName}
                  {used && ' (Used)'}
                  {!roundEndPassed && !used && ' : Locked'}
                </div>
                {b.didPlay && b.breakdown && (
                  <div className={`text-[10px] truncate ${live ? 'text-amber-600' : 'text-slate-500'}`}>{b.breakdown}</div>
                )}
              </div>
              <div className={`text-[13px] font-bold text-right tabular-nums ${scoreColor}`}>
                {live && <LiveDot />}{b.score}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PositionList({ scores, roundEndPassed }) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-white shadow-sm p-3">
      <div className="flex flex-col gap-0.5">
        {(scores.positionScores || []).map((p) => {
          const didNotPlay = p.noStats || !p.player?.hasPlayed;
          const isReplaced = p.isBenchPlayer;
          const isLive = p.isGameLive;
          const showDNP = roundEndPassed && didNotPlay;

          const headline = p.originalScore ?? p.score;
          const scoreColor = showDNP
            ? 'text-red-600'
            : isReplaced
              ? 'text-emerald-600'
              : isLive
                ? 'text-amber-600'
                : 'text-slate-900';
          const nameColor = (showDNP || isReplaced) ? 'text-red-600 line-through' : 'text-slate-900';

          return (
            <div
              key={p.position}
              className={`grid grid-cols-[84px_1fr_50px] items-center gap-2 px-1.5 py-1.5 rounded-lg ${isLive ? 'bg-amber-50' : ''}`}
            >
              <div className="text-[10px] font-extrabold uppercase tracking-[0.04em] text-slate-500">
                {p.position}
              </div>
              <div className="min-w-0">
                <div className={`text-[13px] font-bold truncate ${nameColor}`}>
                  {p.originalPlayerName || 'Not Selected'}
                </div>
                {/* Stat breakdown detail line — same data the desktop card shows */}
                {isReplaced ? (
                  <div className="text-[11px] font-semibold text-emerald-600 truncate">
                    → {p.playerName}{p.breakdown ? ` · ${p.breakdown}` : ''}
                  </div>
                ) : showDNP ? (
                  <div className="text-[10px] text-red-600">Did not play</div>
                ) : p.breakdown ? (
                  <div className={`text-[10px] truncate ${isLive ? 'text-amber-600' : 'text-slate-500'}`}>
                    {p.breakdown}
                  </div>
                ) : null}
              </div>
              <div className={`text-[15px] font-extrabold text-right tabular-nums ${scoreColor}`}>
                {isLive && <LiveDot />}
                {isReplaced ? p.score : headline}
              </div>
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="flex border-t border-slate-200 mt-3 pt-2.5 pb-1">
        {[
          { label: 'Team', value: scores.totalScore, accent: false },
          { label: 'Dead Cert', value: `${scores.deadCertScore >= 0 ? '+' : ''}${scores.deadCertScore}`, accent: false },
          { label: 'Final', value: scores.finalScore, accent: true },
        ].map((cell, i) => (
          <div key={cell.label} className={`flex-1 text-center ${i > 0 ? 'border-l border-slate-200' : ''}`}>
            <div className={`text-[9px] font-extrabold uppercase tracking-[0.08em] ${cell.accent ? 'text-blue-600' : 'text-slate-500'}`}>
              {cell.label}
            </div>
            <div className={`mt-0.5 text-[17px] tabular-nums ${cell.accent ? 'font-black text-blue-600' : 'font-extrabold text-slate-900'}`}>
              {cell.value}
            </div>
          </div>
        ))}
      </div>

      {/* Bench / reserves */}
      <BenchList scores={scores} roundEndPassed={roundEndPassed} />
    </div>
  );
}

// Position-by-position ledger for an expanded fixture
function HeadToHead({ homeId, awayId, getTeamScores, liveUserIds }) {
  const homeScores = getTeamScores(homeId) || {};
  const awayScores = getTeamScores(awayId) || {};
  const homePos = homeScores.positionScores || [];
  const awayPos = awayScores.positionScores || [];
  const homeBench = homeScores.benchScores || [];
  const awayBench = awayScores.benchScores || [];
  const homeLive = liveUserIds.includes(String(homeId));
  const awayLive = liveUserIds.includes(String(awayId));

  // Match by position NAME (not array index) so rows always align.
  const awayByPos = {};
  awayPos.forEach((p) => { awayByPos[p.position] = p; });
  // The player whose score actually counts (replacement if substituted).
  const effName = (p) => (p.isBenchPlayer ? (p.playerName || p.originalPlayerName) : p.originalPlayerName) || '—';

  let hWins = 0, aWins = 0;
  const rows = [];
  homePos.forEach((hp) => {
    const ap = awayByPos[hp.position] || {};
    const hs = hp.score ?? 0, as = ap.score ?? 0;
    const hWin = hs > as, aWin = as > hs;
    if (hWin) hWins++; else if (aWin) aWins++;
    rows.push({ pos: hp.position, hName: effName(hp), hScore: hs, hWin,
                aName: effName(ap), aScore: as, aWin });
  });

  // Bench / reserves rows (shown but NOT counted in the positions-won tally,
  // since reserves only score when subbed in).
  const awayBenchByPos = {};
  awayBench.forEach((b) => { awayBenchByPos[b.position] = b; });
  // What position(s) a bench/reserve is covering (its "backing up").
  const backupOf = (b) => (!b || !b.position) ? '' : (b.isBeingUsed
    ? `→ ${b.replacingPosition || 'in use'}`
    : b.position === 'Reserve A' ? 'FF · TF · RK'
      : b.position === 'Reserve B' ? 'OFF · MID · TAK'
        : (b.backupPosition || 'Utility'));
  const benchRows = homeBench.map((hb) => {
    const ab = awayBenchByPos[hb.position] || {};
    return {
      pos: hb.position,
      hName: hb.playerName || '—', hScore: hb.score ?? 0, hUsed: hb.isBeingUsed, hLive: hb.isGameLive, hBackup: backupOf(hb),
      aName: ab.playerName || '—', aScore: ab.score ?? 0, aUsed: ab.isBeingUsed, aLive: ab.isGameLive, aBackup: backupOf(ab),
    };
  });

  // Abbreviate position to fit the center column
  const abbr = (p) => ({ 'Full Forward': 'FF', 'Tall Forward': 'TF', Offensive: 'OFF', Midfielder: 'MID', Tackler: 'TAK', Ruck: 'RK', Bench: 'BEN', 'Reserve A': 'R-A', 'Reserve B': 'R-B' }[p] || p.slice(0, 3).toUpperCase());
  const sCls = (win, live) => `text-[14px] font-extrabold tabular-nums w-6 text-center ${live ? 'text-amber-600' : win ? 'text-emerald-600' : 'text-slate-600'}`;
  const nCls = (win) => `text-[11px] truncate ${win ? 'font-bold text-slate-900' : 'font-medium text-slate-500'}`;
  // Bench: neutral, with "in use" reserve highlighted green, live amber.
  const bScore = (used, live) => `text-[13px] font-bold tabular-nums w-6 text-center ${used ? 'text-emerald-600' : live ? 'text-amber-600' : 'text-slate-500'}`;
  const bName = (used) => `text-[11px] truncate ${used ? 'font-semibold text-emerald-600' : 'font-medium text-slate-500'}`;

  return (
    <div className="mt-2.5 border-t border-slate-200 pt-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Head to Head</span>
        <span className="text-[10px] font-bold text-slate-500">Positions won {hWins}–{aWins}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.pos} className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <div className={`text-right ${nCls(r.hWin)}`}>{r.hName}</div>
            <div className="flex items-center justify-center gap-1.5">
              <span className={sCls(r.hWin, homeLive)}>{r.hScore}</span>
              <span className="text-[7px] font-extrabold uppercase text-slate-400 w-[26px] text-center">{abbr(r.pos)}</span>
              <span className={sCls(r.aWin, awayLive)}>{r.aScore}</span>
            </div>
            <div className={`text-left ${nCls(r.aWin)}`}>{r.aName}</div>
          </div>
        ))}
      </div>

      {/* Bench / reserves */}
      {benchRows.length > 0 && (
        <>
          <div className="mt-2.5 mb-1.5 text-[8px] font-extrabold uppercase tracking-[0.1em] text-slate-400">Bench / Reserves</div>
          <div className="flex flex-col gap-1.5">
            {benchRows.map((r) => (
              <div key={r.pos} className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                <div className="text-right min-w-0">
                  <div className={bName(r.hUsed)}>{r.hName}{r.hUsed ? ' (Used)' : ''}</div>
                  <div className={`text-[8px] truncate ${r.hUsed ? 'text-emerald-600' : 'text-slate-400'}`}>{r.hBackup}</div>
                </div>
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span className={bScore(r.hUsed, r.hLive)}>{r.hScore}</span>
                    <span className="text-[7px] font-extrabold uppercase text-slate-400 w-[26px] text-center">{abbr(r.pos)}</span>
                    <span className={bScore(r.aUsed, r.aLive)}>{r.aScore}</span>
                  </div>
                </div>
                <div className="text-left min-w-0">
                  <div className={bName(r.aUsed)}>{r.aName}{r.aUsed ? ' (Used)' : ''}</div>
                  <div className={`text-[8px] truncate ${r.aUsed ? 'text-emerald-600' : 'text-slate-400'}`}>{r.aBackup}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MobileLiveScoreboard({
  selectedUserId,
  opponentId,
  getTeamScores,
  orderedFixtures = [],
  liveUserIds = [],
  roundEndPassed,
  displayedRound,
  displayRoundName,
  year,
  isLoggedIn = false,
  onRoundChange,
  onRefresh,
  isRefreshing = false,
}) {
  const [tab, setTab] = useState('team');
  const [openGame, setOpenGame] = useState(null); // index of expanded fixture

  const isLiveRound = liveUserIds.length > 0;
  const myScores = selectedUserId ? getTeamScores(selectedUserId) : null;
  const oppScores = opponentId ? getTeamScores(opponentId) : null;
  const hasMatch = Boolean(selectedUserId && opponentId && myScores && oppScores);

  const myFinal = myScores?.finalScore ?? 0;
  const oppFinal = oppScores?.finalScore ?? 0;
  const sum = myFinal + oppFinal;
  const myPct = sum > 0 ? (myFinal / sum) * 100 : 50;
  const myLive = liveUserIds.includes(String(selectedUserId));
  const oppLive = liveUserIds.includes(String(opponentId));

  // Ranked all teams by finalScore
  const ranked = Object.keys(USER_NAMES)
    .map((uid) => ({ uid, score: getTeamScores(uid)?.finalScore ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const activeId = tab === 'opp' ? opponentId : selectedUserId;
  const activeScores = tab === 'opp' ? oppScores : myScores;

  const tabBtn = (key, label, disabled = false) => (
    <button
      key={key}
      disabled={disabled}
      onClick={() => setTab(key)}
      className={`flex-1 rounded-[10px] py-2.5 text-[13px] font-extrabold transition-colors ${
        tab === key ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-500'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div className="block sm:hidden -mx-4 px-4 pb-10 pt-2 text-slate-700">
      {/* Header — round selector + refresh sit in the right column */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-amber-600">
            {year ? `${year} Season` : displayRoundName(displayedRound)}{isLiveRound ? ' · Live' : ''}
          </div>
          <h1 className="mt-0.5 text-[27px] font-black tracking-[-0.03em] leading-none text-slate-900">
            Team Scores
          </h1>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {isLiveRound && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-1 text-[11px] font-extrabold tracking-[0.04em] text-amber-700">
              <LiveDot /> LIVE
            </span>
          )}
          <div className="flex items-center gap-2">
            {isLoggedIn && onRoundChange && (
              <select
                value={displayedRound ?? ''}
                onChange={onRoundChange}
                className="dz-select py-1.5 text-sm"
              >
                {[...Array(25)].map((_, i) => (
                  <option key={i} value={i}>{displayRoundName(i)}</option>
                ))}
              </select>
            )}
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                title="Refresh live scores"
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Your Match hero */}
      {hasMatch && (
        <div className="rounded-[22px] border border-blue-200 p-4 bg-blue-50 shadow-[0_10px_30px_-18px_rgba(37,99,235,0.45)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-blue-600">Your Match</span>
            {(myLive || oppLive) && (
              <span className="inline-flex items-center text-[10px] font-extrabold uppercase tracking-[0.06em] text-amber-600">
                <LiveDot /> In Play
              </span>
            )}
          </div>

          {/* You */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[22px] leading-none">{TEAM_LOGOS[selectedUserId]}</span>
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-900 truncate max-w-[150px]">{USER_NAMES[selectedUserId]}</div>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-blue-600">You</div>
              </div>
            </div>
            <div className={`text-[34px] font-black tracking-[-0.03em] leading-none tabular-nums ${myLive ? 'text-amber-600' : 'text-slate-900'}`}>
              {myLive && <LiveDot />}{myFinal}
            </div>
          </div>

          {/* Margin bar */}
          <div className="flex h-[7px] rounded-full overflow-hidden bg-slate-200 my-3">
            <div className="bg-gradient-to-r from-blue-500 to-blue-400" style={{ width: `${myPct}%` }} />
            <div className="bg-slate-300" style={{ width: `${100 - myPct}%` }} />
          </div>

          {/* Opponent */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[22px] leading-none">{TEAM_LOGOS[opponentId]}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-600 truncate max-w-[150px]">{USER_NAMES[opponentId]}</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-400">Opponent</div>
              </div>
            </div>
            <div className={`text-[30px] font-extrabold tracking-[-0.03em] leading-none tabular-nums ${oppLive ? 'text-amber-600' : 'text-slate-500'}`}>
              {oppLive && <LiveDot />}{oppFinal}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-[13px] border border-slate-200 bg-slate-100 p-1 my-4">
        {tabBtn('team', 'My Team')}
        {tabBtn('opp', 'Opposition', !opponentId)}
        {tabBtn('round', 'The Round')}
      </div>

      {/* My Team / Opposition */}
      {(tab === 'team' || tab === 'opp') && activeScores && (
        <>
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[18px] leading-none">{TEAM_LOGOS[activeId]}</span>
              <span className="text-[13px] font-extrabold text-slate-900 truncate">{USER_NAMES[activeId]}</span>
            </div>
            <span className={`shrink-0 text-[9px] font-extrabold uppercase tracking-[0.08em] rounded-full px-2 py-0.5 border ${
              tab === 'opp'
                ? 'text-slate-600 bg-slate-100 border-slate-200'
                : 'text-blue-700 bg-blue-50 border-blue-200'
            }`}>
              {tab === 'opp' ? 'Opponent' : 'Your team'}
            </span>
          </div>
          <PositionList scores={activeScores} roundEndPassed={roundEndPassed} />
        </>
      )}

      {/* The Round */}
      {tab === 'round' && (
        <div className="flex flex-col gap-2.5">
          {orderedFixtures.map((f, i) => {
            const home = getTeamScores(f.home)?.finalScore ?? 0;
            const away = getTeamScores(f.away)?.finalScore ?? 0;
            const homeLive = liveUserIds.includes(String(f.home));
            const awayLive = liveUserIds.includes(String(f.away));
            const live = homeLive || awayLive;
            const yours = String(f.home) === String(selectedUserId) || String(f.away) === String(selectedUserId);
            const row = (id, score, rowLive, win) => (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base">{TEAM_LOGOS[id]}</span>
                  <span className={`text-[13px] truncate ${win ? 'font-bold text-slate-900' : 'font-medium text-slate-500'}`}>
                    {USER_NAMES[id]}
                  </span>
                </div>
                <span className={`text-[19px] font-extrabold tabular-nums ${rowLive ? 'text-amber-600' : win ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {rowLive && <LiveDot />}{score}
                </span>
              </div>
            );
            return (
              <div
                key={`${f.home}-${f.away}`}
                onClick={() => setOpenGame((g) => (g === i ? null : i))}
                className={`cursor-pointer rounded-[15px] border p-3 ${yours ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className={`text-[10px] font-extrabold uppercase tracking-[0.08em] ${yours ? 'text-blue-600' : live ? 'text-amber-600' : 'text-slate-500'}`}>
                    Game {i + 1}{live ? ' · Live' : ''}{yours ? ' · Your match' : ''}
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0">{openGame === i ? '▴' : '▾'}</span>
                </div>
                {row(f.home, home, homeLive, home > away)}
                <div className="h-px bg-slate-200 my-1.5" />
                {row(f.away, away, awayLive, away > home)}
                {openGame === i && (
                  <HeadToHead homeId={f.home} awayId={f.away} getTeamScores={getTeamScores} liveUserIds={liveUserIds} />
                )}
              </div>
            );
          })}

          <div className="mt-3 mb-1 px-1 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
            {displayRoundName(displayedRound)} · all teams
          </div>
          <div className="rounded-[16px] border border-slate-200 bg-white overflow-hidden">
            {ranked.map((t, i) => {
              const isUser = String(t.uid) === String(selectedUserId);
              const live = liveUserIds.includes(String(t.uid));
              return (
                <div key={t.uid} className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-slate-100 ${isUser ? 'bg-blue-50' : ''}`}>
                  <span className="w-[18px] text-center text-xs font-extrabold text-slate-400 tabular-nums">{i + 1}</span>
                  <span className="text-base">{TEAM_LOGOS[t.uid]}</span>
                  <span className={`flex-1 truncate text-[13px] ${isUser ? 'font-extrabold text-slate-900' : 'font-semibold text-slate-600'}`}>
                    {USER_NAMES[t.uid]}
                  </span>
                  {isUser && (
                    <span className="text-[8px] font-extrabold tracking-[0.08em] text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-px">YOU</span>
                  )}
                  <span className={`text-base font-extrabold tabular-nums ${live ? 'text-amber-600' : isUser ? 'text-blue-600' : 'text-slate-900'}`}>{t.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

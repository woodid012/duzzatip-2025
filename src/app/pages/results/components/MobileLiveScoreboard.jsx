'use client';

import { useState } from 'react';
import { USER_NAMES, TEAM_LOGOS } from '@/app/lib/constants';

// Small pulsing dot used on live scores
const LiveDot = ({ className = 'bg-amber-400' }) => (
  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle animate-pulse ${className}`} />
);

// Bench + reserves, rendered inside the breakdown
function BenchList({ scores, roundEndPassed }) {
  const bench = scores.benchScores || [];
  if (bench.length === 0) return null;
  return (
    <div className="mt-3 rounded-[13px] border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Bench / Reserves</div>
      <div className="flex flex-col gap-0.5">
        {bench.map((b) => {
          const showDNP = roundEndPassed && !b.didPlay;
          const used = b.isBeingUsed;
          const live = b.isGameLive;
          const scoreColor = showDNP ? 'text-red-400' : used ? 'text-emerald-400' : live ? 'text-amber-400' : 'text-slate-400';
          const nameColor = used ? 'text-emerald-400' : showDNP ? 'text-red-400' : 'text-slate-300';
          return (
            <div key={b.position} className={`grid grid-cols-[96px_1fr_44px] items-center gap-2 px-1.5 py-1 rounded-md ${live ? 'bg-amber-600/12' : ''}`}>
              <div className="text-[10px] font-bold text-slate-400 truncate">{b.position}</div>
              <div className="min-w-0">
                <div className={`text-[12px] font-semibold truncate ${nameColor}`}>
                  {b.playerName}
                  {used && ' (Used)'}
                  {!roundEndPassed && !used && ' : Locked'}
                </div>
                {b.didPlay && b.breakdown && (
                  <div className={`text-[10px] truncate ${live ? 'text-amber-400' : 'text-slate-500'}`}>{b.breakdown}</div>
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
    <div className="rounded-[18px] border border-white/[0.07] bg-white/[0.03] p-3">
      <div className="flex flex-col gap-0.5">
        {(scores.positionScores || []).map((p) => {
          const didNotPlay = p.noStats || !p.player?.hasPlayed;
          const isReplaced = p.isBenchPlayer;
          const isLive = p.isGameLive;
          const showDNP = roundEndPassed && didNotPlay;

          const headline = p.originalScore ?? p.score;
          const scoreColor = showDNP
            ? 'text-red-400'
            : isReplaced
              ? 'text-emerald-400'
              : isLive
                ? 'text-amber-400'
                : 'text-slate-50';
          const nameColor = (showDNP || isReplaced) ? 'text-red-400 line-through' : 'text-slate-200';

          return (
            <div
              key={p.position}
              className={`grid grid-cols-[84px_1fr_50px] items-center gap-2 px-1.5 py-1.5 rounded-lg ${isLive ? 'bg-amber-600/12' : ''}`}
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
                  <div className="text-[11px] font-semibold text-emerald-400 truncate">
                    → {p.playerName}{p.breakdown ? ` · ${p.breakdown}` : ''}
                  </div>
                ) : showDNP ? (
                  <div className="text-[10px] text-red-400">Did not play</div>
                ) : p.breakdown ? (
                  <div className={`text-[10px] truncate ${isLive ? 'text-amber-400' : 'text-slate-500'}`}>
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
      <div className="flex border-t border-white/[0.08] mt-3 pt-2.5 pb-1">
        {[
          { label: 'Team', value: scores.totalScore, accent: false },
          { label: 'Dead Cert', value: `${scores.deadCertScore >= 0 ? '+' : ''}${scores.deadCertScore}`, accent: false },
          { label: 'Final', value: scores.finalScore, accent: true },
        ].map((cell, i) => (
          <div key={cell.label} className={`flex-1 text-center ${i > 0 ? 'border-l border-white/[0.08]' : ''}`}>
            <div className={`text-[9px] font-extrabold uppercase tracking-[0.08em] ${cell.accent ? 'text-blue-400' : 'text-slate-500'}`}>
              {cell.label}
            </div>
            <div className={`mt-0.5 text-[17px] tabular-nums ${cell.accent ? 'font-black text-blue-400' : 'font-extrabold text-slate-200'}`}>
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
  const homePos = getTeamScores(homeId)?.positionScores || [];
  const awayPos = getTeamScores(awayId)?.positionScores || [];
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
  // Abbreviate position to fit the center column
  const abbr = (p) => ({ 'Full Forward': 'FF', 'Tall Forward': 'TF', Offensive: 'OFF', Midfielder: 'MID', Tackler: 'TAK', Ruck: 'RK' }[p] || p.slice(0, 3).toUpperCase());
  const sCls = (win, live) => `text-[14px] font-extrabold tabular-nums w-6 text-center ${live ? 'text-amber-400' : win ? 'text-emerald-400' : 'text-slate-300'}`;
  const nCls = (win) => `text-[11px] truncate ${win ? 'font-bold text-slate-200' : 'font-medium text-slate-500'}`;

  return (
    <div className="mt-2.5 border-t border-white/[0.07] pt-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Head to Head</span>
        <span className="text-[10px] font-bold text-slate-400">Positions won {hWins}–{aWins}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.pos} className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <div className={`text-right ${nCls(r.hWin)}`}>{r.hName}</div>
            <div className="flex items-center justify-center gap-1.5">
              <span className={sCls(r.hWin, homeLive)}>{r.hScore}</span>
              <span className="text-[7px] font-extrabold uppercase text-slate-600 w-[18px] text-center">{abbr(r.pos)}</span>
              <span className={sCls(r.aWin, awayLive)}>{r.aScore}</span>
            </div>
            <div className={`text-left ${nCls(r.aWin)}`}>{r.aName}</div>
          </div>
        ))}
      </div>
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
        tab === key ? 'bg-blue-500 text-white' : 'bg-transparent text-slate-400'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div className="block sm:hidden -mx-4 px-4 pb-10 pt-2 bg-gradient-to-b from-[#0b1120] via-slate-900 to-[#0b1120] text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-amber-400">
            {displayRoundName(displayedRound)}{isLiveRound ? ' · Live' : ''}
          </div>
          <h1 className="mt-0.5 text-[27px] font-black tracking-[-0.03em] leading-none text-white">
            Team Scores
          </h1>
        </div>
        {isLiveRound && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-600/15 border border-amber-400/30 px-2.5 py-1 text-[11px] font-extrabold tracking-[0.04em] text-amber-300">
            <LiveDot className="bg-amber-300" /> LIVE
          </span>
        )}
      </div>

      {/* Your Match hero */}
      {hasMatch && (
        <div className="rounded-[22px] border border-blue-500/40 p-4 bg-gradient-to-br from-blue-500/20 to-slate-900/20 shadow-[0_10px_30px_-16px_rgba(37,99,235,0.8)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-blue-300">Your Match</span>
            {(myLive || oppLive) && (
              <span className="inline-flex items-center text-[10px] font-extrabold uppercase tracking-[0.06em] text-amber-300">
                <LiveDot className="bg-amber-300" /> In Play
              </span>
            )}
          </div>

          {/* You */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[22px] leading-none">{TEAM_LOGOS[selectedUserId]}</span>
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-white truncate max-w-[150px]">{USER_NAMES[selectedUserId]}</div>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-blue-300">You</div>
              </div>
            </div>
            <div className={`text-[34px] font-black tracking-[-0.03em] leading-none tabular-nums ${myLive ? 'text-amber-400' : 'text-white'}`}>
              {myLive && <LiveDot />}{myFinal}
            </div>
          </div>

          {/* Margin bar */}
          <div className="flex h-[7px] rounded-full overflow-hidden bg-white/10 my-3">
            <div className="bg-gradient-to-r from-blue-500 to-blue-400" style={{ width: `${myPct}%` }} />
            <div className="bg-slate-400/45" style={{ width: `${100 - myPct}%` }} />
          </div>

          {/* Opponent */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[22px] leading-none">{TEAM_LOGOS[opponentId]}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-300 truncate max-w-[150px]">{USER_NAMES[opponentId]}</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-500">Opponent</div>
              </div>
            </div>
            <div className={`text-[30px] font-extrabold tracking-[-0.03em] leading-none tabular-nums ${oppLive ? 'text-amber-400' : 'text-slate-400'}`}>
              {oppLive && <LiveDot />}{oppFinal}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-[13px] border border-white/[0.08] bg-white/[0.05] p-1 my-4">
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
              <span className="text-[13px] font-extrabold text-slate-100 truncate">{USER_NAMES[activeId]}</span>
            </div>
            <span className={`shrink-0 text-[9px] font-extrabold uppercase tracking-[0.08em] rounded-full px-2 py-0.5 border ${
              tab === 'opp'
                ? 'text-slate-400 bg-slate-400/10 border-slate-400/25'
                : 'text-blue-400 bg-blue-500/15 border-blue-500/30'
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
                  <span className={`text-[13px] truncate ${win ? 'font-bold text-slate-100' : 'font-medium text-slate-400'}`}>
                    {USER_NAMES[id]}
                  </span>
                </div>
                <span className={`text-[19px] font-extrabold tabular-nums ${rowLive ? 'text-amber-400' : win ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {rowLive && <LiveDot />}{score}
                </span>
              </div>
            );
            return (
              <div
                key={`${f.home}-${f.away}`}
                onClick={() => setOpenGame((g) => (g === i ? null : i))}
                className={`cursor-pointer rounded-[15px] border p-3 ${yours ? 'bg-blue-500/10 border-blue-500/35' : 'bg-white/[0.03] border-white/[0.07]'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className={`text-[10px] font-extrabold uppercase tracking-[0.08em] ${yours ? 'text-blue-400' : live ? 'text-amber-400' : 'text-slate-500'}`}>
                    Game {i + 1}{live ? ' · Live' : ''}{yours ? ' · Your match' : ''}
                  </div>
                  <span className="text-[11px] text-slate-500 shrink-0">{openGame === i ? '▴' : '▾'}</span>
                </div>
                {row(f.home, home, homeLive, home > away)}
                <div className="h-px bg-white/[0.06] my-1.5" />
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
          <div className="rounded-[16px] border border-white/[0.07] bg-white/[0.03] overflow-hidden">
            {ranked.map((t, i) => {
              const isUser = String(t.uid) === String(selectedUserId);
              const live = liveUserIds.includes(String(t.uid));
              return (
                <div key={t.uid} className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-white/5 ${isUser ? 'bg-blue-500/10' : ''}`}>
                  <span className="w-[18px] text-center text-xs font-extrabold text-slate-500 tabular-nums">{i + 1}</span>
                  <span className="text-base">{TEAM_LOGOS[t.uid]}</span>
                  <span className={`flex-1 truncate text-[13px] ${isUser ? 'font-extrabold text-white' : 'font-semibold text-slate-300'}`}>
                    {USER_NAMES[t.uid]}
                  </span>
                  {isUser && (
                    <span className="text-[8px] font-extrabold tracking-[0.08em] text-blue-400 bg-blue-500/15 border border-blue-500/30 rounded-full px-1.5 py-px">YOU</span>
                  )}
                  <span className={`text-base font-extrabold tabular-nums ${live ? 'text-amber-400' : isUser ? 'text-blue-400' : 'text-slate-200'}`}>{t.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

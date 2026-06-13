'use client'

import { TEAM_LOGOS } from '@/app/lib/constants';

// Map a stored position label/code to its full name + sparkline key.
const POS_META = {
  'full forward': { full: 'Full Forward', short: 'FF' }, ff: { full: 'Full Forward', short: 'FF' },
  'tall forward': { full: 'Tall Forward', short: 'TF' }, tf: { full: 'Tall Forward', short: 'TF' },
  offensive: { full: 'Offensive', short: 'OFF' }, off: { full: 'Offensive', short: 'OFF' },
  midfielder: { full: 'Midfielder', short: 'MID' }, mid: { full: 'Midfielder', short: 'MID' },
  tackler: { full: 'Tackler', short: 'TAK' }, tak: { full: 'Tackler', short: 'TAK' },
  ruck: { full: 'Ruck', short: 'RK' }, ruc: { full: 'Ruck', short: 'RK' }, rk: { full: 'Ruck', short: 'RK' },
};
function posMeta(raw) {
  const k = String(raw || '').toLowerCase().trim();
  return POS_META[k] || { full: raw || '', short: String(raw || '').slice(0, 3).toUpperCase() };
}

// Helper function to get 3-letter team abbreviation
const getTeamAbbreviation = (teamName) => {
  if (!teamName) return '';
  const abbreviations = {
    'Adelaide': 'ADE', 'Brisbane Lions': 'BRL', 'Brisbane': 'BRL', 'Carlton': 'CAR',
    'Collingwood': 'COL', 'Essendon': 'ESS', 'Fremantle': 'FRE', 'Geelong': 'GEE',
    'Gold Coast': 'GCS', 'Greater Western Sydney': 'GWS', 'GWS Giants': 'GWS', 'Hawthorn': 'HAW',
    'Melbourne': 'MEL', 'North Melbourne': 'NTH', 'Port Adelaide': 'PTA', 'Richmond': 'RIC',
    'St Kilda': 'STK', 'Sydney': 'SYD', 'West Coast': 'WCE', 'Western Bulldogs': 'WBD', 'Bulldogs': 'WBD',
  };
  if (abbreviations[teamName]) return abbreviations[teamName];
  for (const [team, abbr] of Object.entries(abbreviations)) {
    if (teamName.includes(team)) return abbr;
  }
  return teamName.substring(0, 3).toUpperCase();
};

// The score that counts for a position: replacement's when substituted, else the player's.
const dispScore = (p) => (p.isBenchPlayer ? (p.score ?? 0) : (p.originalScore ?? p.score ?? 0));

// TeamScoreCard — a single team's score, in compact or expanded mode.
export default function TeamScoreCard({
  userId,
  userName,
  teamScores,
  isHighestScore,
  isLowestScore,
  isUserTeam,
  isRoundComplete,
  rank,
  isOpen,
  collapsible = true,
  onToggle,
}) {
  const positions = teamScores.positionScores || [];
  const bench = teamScores.benchScores || [];
  const anyLive = positions.some((p) => p.isGameLive) || bench.some((b) => b.isGameLive);
  const teamMax = positions.length ? Math.max(...positions.map(dispScore)) : 0;
  const topPlayer = positions.reduce((best, p) => (dispScore(p) > dispScore(best || p) ? p : best || p), null);

  const badge = isHighestScore ? '⭐' : isLowestScore ? '🦀' : '';

  return (
    <div
      id={`team-card-${userId}`}
      className={`scroll-mt-4 rounded-[18px] bg-white px-5 py-[18px] ${
        isUserTeam
          ? 'border border-blue-200 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_0_0_4px_rgba(37,99,235,0.07)]'
          : 'border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-lg text-[13px] font-extrabold tabular-nums ${
              rank === 1
                ? 'border border-amber-300 bg-amber-100 text-amber-700'
                : 'border border-slate-200 bg-slate-100 text-slate-500'
            }`}
          >
            {rank}
          </div>
          <span className="text-2xl leading-none">{TEAM_LOGOS[userId]}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-[7px]">
              <h2 className="max-w-[240px] truncate text-[17px] font-extrabold tracking-[-0.01em] text-slate-900">
                {userName}
              </h2>
              {badge && <span className="text-sm">{badge}</span>}
            </div>
            {isUserTeam && (
              <span className="mt-1 inline-block rounded-full border border-blue-200 bg-blue-50 px-2 py-[2px] text-[9px] font-extrabold tracking-[0.1em] text-blue-600">
                YOUR TEAM
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-[34px] font-black leading-none tracking-[-0.03em] tabular-nums text-slate-900">
            {teamScores.finalScore}
          </div>
          <div className="mt-[5px] flex items-center justify-end">
            <span
              className={`rounded-full px-2 py-[2px] text-[10px] font-extrabold tracking-[0.08em] ${
                anyLive
                  ? 'border border-amber-600/25 bg-amber-600/10 text-amber-600'
                  : 'border border-slate-200 bg-slate-100 text-slate-400'
              }`}
            >
              {anyLive ? 'LIVE' : 'FINAL'}
            </span>
          </div>
          <div className="mt-1 text-[11px] tabular-nums text-slate-400">
            Team {teamScores.totalScore} + Cert {teamScores.deadCertScore}
          </div>
        </div>
      </div>

      {isOpen ? (
        <ExpandedBody
          positions={positions}
          bench={bench}
          teamScores={teamScores}
          isRoundComplete={isRoundComplete}
          collapsible={collapsible}
          onToggle={onToggle}
        />
      ) : (
        <CompactBody
          positions={positions}
          teamMax={teamMax}
          topPlayer={topPlayer}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}

// ── Compact: sparkline + top scorer + "View detail" ─────────────────────────
function CompactBody({ positions, teamMax, topPlayer, onToggle }) {
  return (
    <div className="mt-[15px]">
      <div className="grid grid-cols-6 gap-[6px]">
        {positions.map((p, i) => {
          const disp = dispScore(p);
          const live = p.isGameLive;
          const dnp = p.noStats || disp === 0;
          const top = disp === teamMax && teamMax > 0;
          const tone = live
            ? 'bg-amber-600/10 text-amber-600'
            : dnp
              ? 'bg-red-600/[0.08] text-red-600'
              : top
                ? 'bg-emerald-600/10 text-emerald-600'
                : 'bg-slate-100 text-slate-900';
          return (
            <div key={i} className={`rounded-[9px] px-1 pb-2 pt-[7px] text-center ${tone}`}>
              <div className="text-[8px] font-bold uppercase tracking-[0.06em] text-slate-400">
                {posMeta(p.position).short}
              </div>
              <div className="mt-[2px] text-[15px] font-extrabold tabular-nums">{disp}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-[10px]">
        <span className="truncate text-xs text-slate-500">
          Top: <span className="font-bold text-slate-900">{topPlayer?.originalPlayerName || topPlayer?.playerName || '-'}</span>
          {topPlayer ? ` · ${dispScore(topPlayer)}` : ''}
        </span>
        <button
          onClick={onToggle}
          className="flex-shrink-0 whitespace-nowrap rounded-[9px] border border-slate-200 bg-slate-100 px-3 py-[6px] text-xs font-bold text-slate-600 transition-colors hover:bg-slate-200"
        >
          View detail ▾
        </button>
      </div>
    </div>
  );
}

// ── Expanded: full position list, bench, totals ─────────────────────────────
function ExpandedBody({ positions, bench, teamScores, isRoundComplete, collapsible, onToggle }) {
  return (
    <div className="mt-4">
      <div className="flex flex-col gap-[3px]">
        {positions.map((p, i) => {
          const isReplaced = p.isBenchPlayer;
          const isLive = p.isGameLive;
          const didNotPlay = p.noStats || !p.player?.hasPlayed;
          const showDNP = isRoundComplete && didNotPlay && !isReplaced;
          const disp = dispScore(p);
          const abbr = getTeamAbbreviation(p.team || p.player?.team);

          let nameCls = 'text-slate-900';
          let detailCls = 'text-slate-400';
          let scoreCls = 'text-slate-900';
          let struck = false;
          let detail = p.breakdown;

          if (isReplaced) {
            nameCls = 'text-red-600'; struck = true; detailCls = 'text-emerald-600'; scoreCls = 'text-emerald-600';
            detail = `→ ${p.playerName}${abbr ? ` (${abbr})` : ''} in · ${p.score} pts`;
          } else if (showDNP) {
            nameCls = 'text-red-600'; struck = true; detailCls = 'text-red-600'; scoreCls = 'text-red-600';
            detail = 'Did not play';
          } else if (isLive) {
            detailCls = 'text-amber-700'; scoreCls = 'text-amber-600';
          }

          return (
            <div
              key={i}
              className={`grid grid-cols-[108px_1fr_56px] items-center gap-[10px] rounded-[9px] px-2 py-[7px] ${
                isLive ? 'bg-amber-600/[0.07]' : ''
              }`}
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.02em] text-slate-500">
                {posMeta(p.position).full}
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-[6px]">
                  <span className={`truncate text-sm font-semibold ${nameCls} ${struck ? 'line-through' : ''}`}>
                    {p.originalPlayerName || 'Not Selected'}
                  </span>
                  {abbr && <span className="flex-shrink-0 text-[11px] font-semibold text-slate-400">{abbr}</span>}
                </div>
                {detail && <div className={`mt-[1px] truncate text-[11px] ${detailCls}`}>{detail}</div>}
              </div>
              <div className={`text-right text-base font-extrabold tabular-nums ${scoreCls}`}>
                {isLive && <span className="mr-[5px] inline-block h-[6px] w-[6px] rounded-full bg-amber-600 align-middle animate-pulse-dot" />}
                {disp}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bench / Reserves */}
      <div className="mt-3 rounded-[12px] border border-slate-100 bg-slate-50 px-[13px] py-3">
        <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-400">Bench / Reserves</div>
        {(!bench || bench.length === 0) ? (
          <div className="text-xs italic text-slate-400">No bench or reserve players selected</div>
        ) : (
          <div className="flex flex-col gap-[2px]">
            {bench.map((b, i) => {
              const inUse = b.isBeingUsed;
              const abbr = getTeamAbbreviation(b.player?.team);
              const sub = inUse
                ? 'in use · substituting'
                : b.position === 'Reserve A'
                  ? 'Full Forward, Tall Forward, Ruck'
                  : b.position === 'Reserve B'
                    ? 'Offensive, Mid, Tackler'
                    : b.backupPosition || 'utility';
              return (
                <div key={i} className="grid grid-cols-[128px_1fr_48px] items-center gap-[10px] rounded-lg px-[6px] py-[5px]">
                  <div>
                    <div className="text-[11px] font-bold text-slate-600">{b.position}</div>
                    <div className="text-[9px] tracking-[0.02em] text-slate-400">{sub}</div>
                  </div>
                  <div className="flex min-w-0 items-baseline gap-[6px]">
                    <span className={`truncate text-[13px] font-semibold ${inUse ? 'text-emerald-600' : 'text-slate-600'}`}>
                      {b.playerName}
                    </span>
                    {abbr && <span className="text-[11px] font-semibold text-slate-300">{abbr}</span>}
                  </div>
                  <div className={`text-right text-sm font-bold tabular-nums ${inUse ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {b.score}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Totals footer */}
      <div className="mt-[13px] flex items-stretch border-t border-slate-100 pt-[13px]">
        <div className="flex-1 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Team Score</div>
          <div className="mt-[3px] text-lg font-extrabold tabular-nums text-slate-900">{teamScores.totalScore}</div>
        </div>
        <div className="w-px bg-slate-100" />
        <div className="flex-1 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Dead Cert</div>
          <div className="mt-[3px] text-lg font-extrabold tabular-nums text-slate-900">
            {teamScores.deadCertScore >= 0 ? '+' : ''}{teamScores.deadCertScore}
          </div>
        </div>
        <div className="w-px bg-slate-100" />
        <div className="flex-1 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-blue-600">Final Total</div>
          <div className="mt-[3px] text-lg font-black tabular-nums text-blue-600">{teamScores.finalScore}</div>
        </div>
      </div>

      {collapsible && (
        <div className="mt-3 flex justify-center">
          <button onClick={onToggle} className="px-[10px] py-1 text-xs font-bold text-slate-400 hover:text-slate-600">
            Hide detail ▴
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { USER_NAMES, TEAM_LOGOS } from '@/app/lib/constants';

// Where the cut line falls in a sorted (desc) scores array — everything at or
// after this index is cut (finalized week) or "on the bubble" (live week).
const computeCutIndex = (week) => {
  if (Array.isArray(week.eliminated)) return Math.max(0, week.scores.length - week.eliminated.length);
  if (Array.isArray(week.aliveAtStart) && week.cutCount != null) {
    return Math.max(0, week.aliveAtStart.length - week.cutCount);
  }
  return null;
};

function WeekColumn({ week, viewerUserId }) {
  const weekNumber = week.round - 25;
  const finalized = Array.isArray(week.eliminated);
  const isLive = week.fixturesKnown && !finalized && (week.scores || []).length > 0;

  const sorted = [...(week.scores || [])].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
  const cutIndex = computeCutIndex(week);

  return (
    <div className="dz-surface p-3 sm:p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Week {weekNumber}</div>
          <h3 className="text-sm font-bold text-slate-900 truncate">{week.label}</h3>
        </div>
        {!week.fixturesKnown && (
          <span className="dz-badge bg-slate-100 text-slate-500 shrink-0">TBC</span>
        )}
        {isLive && (
          <span className="dz-badge bg-blue-100 text-blue-700 shrink-0 animate-pulse">● Live</span>
        )}
        {finalized && (
          <span className="dz-badge bg-emerald-100 text-emerald-700 shrink-0">Final</span>
        )}
      </div>

      {!week.fixturesKnown && (
        <p className="text-xs text-slate-500">
          Fixtures for this week aren&apos;t locked in yet — check back closer to game day.
        </p>
      )}

      {week.fixturesKnown && sorted.length === 0 && (
        <p className="text-xs text-slate-500">No scores yet.</p>
      )}

      {week.fixturesKnown && sorted.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-semibold px-1 py-1">Player</th>
                <th className="text-right font-semibold px-1 py-1">Team</th>
                <th className="text-right font-semibold px-1 py-1">Certs</th>
                <th className="text-right font-semibold px-1 py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, idx) => {
                const cut = cutIndex != null && idx >= cutIndex;
                const isViewer = viewerUserId && String(row.userId) === String(viewerUserId);
                const eliminatedHere = finalized && Array.isArray(week.eliminated) && week.eliminated.map(String).includes(String(row.userId));
                return (
                  <tr
                    key={row.userId}
                    className={`${cutIndex != null && idx === cutIndex ? (finalized ? 'border-t-2 border-red-300' : 'border-t-2 border-dashed border-amber-300') : 'border-t border-slate-100'} ${
                      eliminatedHere ? 'opacity-50' : cut ? 'text-amber-700' : ''
                    } ${isViewer ? 'bg-blue-50/60' : ''}`}
                  >
                    <td className={`px-1 py-1.5 truncate max-w-[120px] ${eliminatedHere ? 'line-through text-slate-400' : 'text-slate-800 font-medium'}`}>
                      {TEAM_LOGOS[row.userId] ?? ''} {USER_NAMES[row.userId] || `User ${row.userId}`}
                    </td>
                    <td className="text-right px-1 py-1.5 tabular-nums text-slate-600">{row.playerScore ?? '-'}</td>
                    <td className={`text-right px-1 py-1.5 tabular-nums ${row.deadCertScore < 0 ? 'text-red-500' : row.deadCertScore > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {row.deadCertScore != null ? (row.deadCertScore > 0 ? `+${row.deadCertScore}` : row.deadCertScore) : '-'}
                    </td>
                    <td className="text-right px-1 py-1.5 tabular-nums font-bold text-slate-900">{row.totalScore ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {week.tieAtCutLine && (
        <p className="text-[11px] text-amber-600 font-medium">Tie at the cut — nobody extra eliminated.</p>
      )}
    </div>
  );
}

export default function BracketTab({ bracket, bracketLoading, bracketError, viewerUserId, onRefresh }) {
  if (bracketLoading && !bracket) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="dz-surface p-4 h-48 animate-pulse bg-slate-100" />
        ))}
      </div>
    );
  }

  if (bracketError) {
    return (
      <div className="dz-surface p-6 text-center">
        <p className="text-red-600 mb-3">{bracketError}</p>
        <button onClick={onRefresh} className="dz-btn-primary">Retry</button>
      </div>
    );
  }

  if (!bracket) return null;

  const champions = bracket.coChampions?.length
    ? bracket.coChampions
    : (bracket.champion != null ? [bracket.champion] : []);

  return (
    <div className="space-y-6">
      {bracket.isComplete && champions.length > 0 && (
        <div className="rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-white p-5 shadow-sm text-center">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] opacity-90 mb-1">
            {champions.length > 1 ? 'Co-Champions' : 'Duzza Finals Champion'}
          </div>
          <div className="text-2xl font-black">
            {champions.map((uid) => `${TEAM_LOGOS[uid] ?? '🏆'} ${USER_NAMES[uid] || uid}`).join('  ·  ')}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {(bracket.weeks || []).map((week) => (
          <WeekColumn key={week.round} week={week} viewerUserId={viewerUserId} />
        ))}
      </div>
    </div>
  );
}

'use client';

import { USER_NAMES, TEAM_LOGOS } from '@/app/lib/constants';
import { DUZZA_FINALS_ROUNDS } from '@/app/hooks/useDuzzaFinals';

const getWeeklyTotal = (entry, round) => {
  if (!entry?.weeklyTotals) return undefined;
  if (Array.isArray(entry.weeklyTotals)) {
    const idx = DUZZA_FINALS_ROUNDS.indexOf(round);
    return idx >= 0 ? entry.weeklyTotals[idx] : undefined;
  }
  return entry.weeklyTotals[round] ?? entry.weeklyTotals[String(round)];
};

// The open pool: everyone — the core 8 plus outside registrations — ranked by
// cumulative total across the four finals weeks. Highest total at the end of
// the Grand Final takes the pool.
export default function PoolTab({
  bracket, bracketLoading, bracketRefreshing, bracketUpdatedAt, bracketError, viewerUserId, onRefresh,
}) {
  if (bracketLoading && !bracket) {
    return <div className="dz-surface p-4 h-64 animate-pulse bg-slate-100" />;
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

  const ladder = [...(bracket.cumulativeLadder || [])].sort(
    (a, b) => (b.grandTotal || 0) - (a.grandTotal || 0)
  );

  // The week still in progress: its column is the one people are watching, so
  // it's highlighted and its scores refresh in place.
  const currentRound = bracket.isComplete ? null : bracket.currentWeek;
  const currentWeek = (bracket.weeks || []).find((w) => w.round === currentRound);
  const isLive = !!currentWeek?.fixturesKnown && !currentWeek?.roundComplete;

  return (
    <div className="space-y-4">
      <div className="dz-surface p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-bold text-slate-900">
            Pool
            {isLive && (
              <span className="dz-badge bg-blue-100 text-blue-700 ml-2 animate-pulse align-middle">● Live</span>
            )}
          </h3>
          <span className="text-[11px] text-slate-400 hidden sm:inline">Best 4-week total wins</span>
        </div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-xs text-slate-500">
            Everyone in the pool, ranked by cumulative score across the finals.
          </p>
          <button
            onClick={onRefresh}
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 shrink-0 disabled:opacity-50"
            disabled={bracketRefreshing}
          >
            {bracketRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {ladder.length === 0 ? (
          <p className="text-xs text-slate-500">Nobody on the board yet.</p>
        ) : (
          <div className="overflow-x-auto">
            {/* dz-table-compact: tight padding on mobile so all four weeks plus
                the total fit beside the name without a horizontal scroll. */}
            <table className="dz-table dz-table-compact w-full">
              <thead>
                <tr>
                  <th className="w-6 sm:w-8">#</th>
                  <th>Team</th>
                  {DUZZA_FINALS_ROUNDS.map((round) => (
                    <th
                      key={round}
                      className={`text-right ${round === currentRound ? 'text-blue-600' : ''}`}
                    >
                      {round === currentRound && isLive ? '●' : ''}<span className="hidden sm:inline">Wk </span>{round - 25}
                    </th>
                  ))}
                  <th className="text-right">Tot</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((entry, idx) => {
                  const isViewer = viewerUserId && String(entry.userId) === String(viewerUserId);
                  return (
                    <tr key={entry.userId} className={isViewer ? 'bg-blue-50/60' : ''}>
                      <td className={`tabular-nums ${idx === 0 ? 'font-black text-amber-600' : 'text-slate-500'}`}>
                        {idx + 1}
                      </td>
                      <td className="font-medium text-slate-900">
                        {/* Truncated on a phone so the score columns always win
                            the available width; full name from sm up. */}
                        <span className="block truncate max-w-[5.5rem] sm:max-w-none">
                          {TEAM_LOGOS[entry.userId] ? `${TEAM_LOGOS[entry.userId]} ` : ''}
                          {entry.name || USER_NAMES[entry.userId] || entry.userId}
                        </span>
                      </td>
                      {DUZZA_FINALS_ROUNDS.map((round) => (
                        <td
                          key={round}
                          className={`text-right tabular-nums ${
                            round === currentRound ? 'font-semibold text-blue-700' : 'text-slate-600'
                          }`}
                        >
                          {getWeeklyTotal(entry, round) ?? '-'}
                        </td>
                      ))}
                      <td className="text-right tabular-nums font-bold text-slate-900">
                        {entry.grandTotal ?? '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mt-3 text-[11px] text-slate-400">
          <span className="sm:hidden">Best 4-week total wins</span>
          {bracketUpdatedAt && (
            <span className="ml-auto">
              Updated {bracketUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

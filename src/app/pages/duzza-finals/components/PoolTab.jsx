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
export default function PoolTab({ bracket, bracketLoading, bracketError, viewerUserId, onRefresh }) {
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

  return (
    <div className="space-y-4">
      <div className="dz-surface p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-bold text-slate-900">Pool</h3>
          <span className="text-[11px] text-slate-400">Best 4-week total wins</span>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Everyone in the pool, ranked by cumulative score across the finals.
        </p>

        {ladder.length === 0 ? (
          <p className="text-xs text-slate-500">Nobody on the board yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="dz-table w-full">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Team</th>
                  {DUZZA_FINALS_ROUNDS.map((round) => (
                    <th key={round} className="text-right">Wk {round - 25}</th>
                  ))}
                  <th className="text-right">Total</th>
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
                        {TEAM_LOGOS[entry.userId] ? `${TEAM_LOGOS[entry.userId]} ` : ''}
                        {entry.name || USER_NAMES[entry.userId] || entry.userId}
                      </td>
                      {DUZZA_FINALS_ROUNDS.map((round) => (
                        <td key={round} className="text-right tabular-nums text-slate-600">
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
      </div>
    </div>
  );
}

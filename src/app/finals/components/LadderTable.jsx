'use client';

import { FINALS_ROUNDS, weekNumberForRound } from '../lib/constants';

// The open-registration cumulative ladder — every entrant, core + invited,
// ranked by grandTotal across the finals weeks played so far.
export default function LadderTable({ cumulativeLadder, viewerId }) {
  const ladder = [...(cumulativeLadder || [])].sort((a, b) => (b.grandTotal || 0) - (a.grandTotal || 0));

  if (ladder.length === 0) {
    return <div className="dz-surface p-6 text-center text-slate-500">No entrants yet.</div>;
  }

  return (
    <div className="dz-surface p-3 sm:p-4">
      <div className="overflow-x-auto">
        <table className="dz-table w-full">
          <thead>
            <tr>
              <th className="w-10">#</th>
              <th>Team</th>
              {FINALS_ROUNDS.map((round) => (
                <th key={round} className="text-right">Wk {weekNumberForRound(round)}</th>
              ))}
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {ladder.map((entry, idx) => {
              const rank = idx + 1;
              const isViewer = viewerId && String(entry.userId) === String(viewerId);
              const isLeader = rank === 1 && entry.grandTotal > 0;
              return (
                <tr key={entry.userId} className={`${isViewer ? 'bg-blue-50/60' : ''} ${isLeader ? 'bg-amber-50/60' : ''}`}>
                  <td className={`font-bold tabular-nums ${isLeader ? 'text-amber-600' : 'text-slate-400'}`}>
                    {isLeader ? '🏆' : rank}
                  </td>
                  <td className="font-medium text-slate-900">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="truncate max-w-[10rem] sm:max-w-none">{entry.name || `Entrant ${entry.userId}`}</span>
                      {isViewer && <span className="text-[10px] text-blue-500 font-semibold">(you)</span>}
                    </span>
                  </td>
                  {FINALS_ROUNDS.map((round) => {
                    const val = entry.weeklyTotals?.[round] ?? entry.weeklyTotals?.[String(round)];
                    return (
                      <td key={round} className="text-right tabular-nums text-slate-600">
                        {val ?? <span className="text-slate-300">-</span>}
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums font-bold text-slate-900">{entry.grandTotal ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';

import { weekNumberForRound } from '../lib/constants';

// Compact secondary view of the core-8 knockout (bottom 2 cut each week,
// Grand Final head-to-head) — informational only for open entrants, who
// don't take part in it. Names resolved from cumulativeLadder.
export default function BracketMini({ weeks, cumulativeLadder, champion, coChampions, isComplete }) {
  const nameById = {};
  (cumulativeLadder || []).forEach((e) => { nameById[e.userId] = e.name; });

  const champions = coChampions?.length ? coChampions : (champion != null ? [champion] : []);

  return (
    <div className="dz-surface p-3 sm:p-4">
      <h3 className="text-sm font-bold text-slate-900 mb-3">Core-8 knockout</h3>
      <p className="text-xs text-slate-500 mb-3">
        The eight core league members also run a separate weekly knockout — bottom two cut each
        week, head-to-head in the Grand Final. It doesn&apos;t affect the open ladder above.
      </p>

      {isComplete && champions.length > 0 && (
        <div className="mb-3 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-white p-3 text-center">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] opacity-90">
            {champions.length > 1 ? 'Co-Champions' : 'Champion'}
          </div>
          <div className="text-sm font-black mt-0.5">
            {champions.map((uid) => nameById[uid] || uid).join(' · ')}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="dz-table w-full">
          <thead>
            <tr>
              <th>Week</th>
              <th>Status</th>
              <th>Cut</th>
              <th>Eliminated</th>
            </tr>
          </thead>
          <tbody>
            {(weeks || []).map((week) => {
              const finalized = Array.isArray(week.eliminated);
              const isLive = week.fixturesKnown && !finalized && (week.scores || []).length > 0;
              return (
                <tr key={week.round}>
                  <td className="font-medium text-slate-800">Wk {weekNumberForRound(week.round)} · {week.label}</td>
                  <td>
                    {!week.fixturesKnown ? (
                      <span className="dz-badge bg-slate-100 text-slate-500">TBC</span>
                    ) : finalized ? (
                      <span className="dz-badge bg-emerald-100 text-emerald-700">Final</span>
                    ) : isLive ? (
                      <span className="dz-badge bg-blue-100 text-blue-700">Live</span>
                    ) : (
                      <span className="dz-badge bg-slate-100 text-slate-500">Pending</span>
                    )}
                  </td>
                  <td className="text-slate-600">{week.cutCount}</td>
                  <td className="text-slate-600">
                    {finalized && week.eliminated.length > 0
                      ? week.eliminated.map((uid) => nameById[uid] || uid).join(', ')
                      : <span className="text-slate-300">-</span>}
                    {week.tieAtCutLine && <span className="ml-1.5 text-[10px] text-amber-600 font-semibold">(tie spared)</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

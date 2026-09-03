'use client';

import { ChevronDown } from 'lucide-react';

// One entrant's week breakdown — position-by-position scores + annotated
// tips. Collapsed to a summary row by default; `expanded` shows the full
// breakdown. Used for both "Your team" (always expanded) and each "Around
// the grounds" row.
export default function EntrantCard({ entrant, expanded, onToggle, isSelf, collapsible = true }) {
  const { name, source, positionScores, benchAndReserves, tips, playerScore, deadCertScore, totalScore, correctTips } = entrant;

  const header = (
    <div className="flex items-center justify-between gap-3 p-3.5 sm:p-4 text-left">
      <div className="min-w-0 flex items-center gap-2">
        {source === 'admin' && (
          <span className="dz-badge bg-slate-100 text-slate-500 border border-slate-200 shrink-0">Admin</span>
        )}
        <span className="font-semibold text-slate-900 truncate">{name}{isSelf ? ' (you)' : ''}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-slate-400 hidden sm:inline">{correctTips} tip{correctTips === 1 ? '' : 's'}</span>
        <span className="font-bold text-slate-900 tabular-nums">{totalScore}</span>
        {collapsible && <ChevronDown size={16} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
      </div>
    </div>
  );

  return (
    <div className={`dz-surface overflow-hidden ${isSelf ? 'ring-2 ring-blue-500/30' : ''}`}>
      {collapsible ? (
        <button type="button" onClick={onToggle} className="w-full">{header}</button>
      ) : header}

      {expanded && (
        <div className="border-t border-slate-100 p-3.5 sm:p-4 space-y-4">
          {positionScores?.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Team</h4>
              <div className="overflow-x-auto">
                <table className="dz-table w-full">
                  <thead>
                    <tr><th>Position</th><th>Player</th><th className="text-right">Score</th></tr>
                  </thead>
                  <tbody>
                    {positionScores.map((p) => (
                      <tr key={p.position}>
                        <td className="font-medium text-slate-700">{p.position}</td>
                        <td className="text-slate-600">
                          {/* On a substitution, show who was picked as well as who
                              is covering — the original is still to play, so the
                              cover can yet be undone. */}
                          {p.isBenchPlayer && p.originalPlayerName && p.originalPlayerName !== p.playerName && (
                            <span className="block text-slate-400 line-through">{p.originalPlayerName}</span>
                          )}
                          {p.playerName || <span className="text-slate-300">—</span>}
                          {p.isBenchPlayer && (
                            <span className="ml-1.5 text-[10px] font-bold uppercase text-blue-500">
                              {p.replacementType || 'sub'}
                            </span>
                          )}
                        </td>
                        <td className="text-right font-semibold text-slate-900 tabular-nums">{p.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {benchAndReserves?.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Bench &amp; reserves</h4>
              <ul className="space-y-1.5">
                {benchAndReserves.map((b) => (
                  <li key={b.position} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 text-slate-600">{b.playerName}</span>
                    <span className="shrink-0 text-right text-xs text-slate-400">
                      <span className="font-medium text-slate-500">{b.position}</span>
                      {b.covers?.length > 0 && (
                        <span className="block text-[10px] leading-tight">{b.covers.join(' · ')}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tips?.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Tips</h4>
              <div className="flex flex-wrap gap-1.5">
                {tips.map((t) => (
                  <span
                    key={t.matchNumber}
                    className={`dz-badge border ${
                      t.correct === true ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : t.correct === false ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                  >
                    {t.tip || '—'}
                    {t.deadCert ? ' ⭐' : ''}
                    {t.correct === true ? ' ✓' : t.correct === false ? ' ✗' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-4 text-xs text-slate-500 pt-1 border-t border-slate-100">
            <span>Team: <strong className="text-slate-700">{playerScore}</strong></span>
            <span>
              Certs:{' '}
              <strong className={deadCertScore < 0 ? 'text-red-600' : deadCertScore > 0 ? 'text-amber-600' : 'text-slate-700'}>
                {deadCertScore > 0 ? `+${deadCertScore}` : deadCertScore}
              </strong>
            </span>
            <span>Total: <strong className="text-slate-900">{totalScore}</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}

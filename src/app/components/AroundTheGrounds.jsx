'use client';

import { TEAM_LOGOS } from '@/app/lib/constants';

// Lock state as a chip. Three states, and the distinction matters:
//   Locked  — got their team in before the first bounce, committed for the round
//   Rolling — missed the deadline, still filling games that haven't started
//   Open    — round hasn't begun, everyone is still free to change
const LOCK_CHIP = {
  locked:  { label: '🔒 Locked',  cls: 'border-slate-300 bg-slate-100 text-slate-600' },
  rolling: { label: '⏳ Rolling', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  open:    { label: 'Open',       cls: 'border-blue-200 bg-blue-50 text-blue-600' },
};

const LiveDot = () => (
  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1 align-middle" />
);

/**
 * Around the Grounds — every player's lock state for the round, and their live
 * score once scores are visible.
 *
 * Lock state is always shown: knowing that someone is locked in gives nothing
 * away about who they picked. Scores are only passed in when the viewer has
 * earned them (the API withholds other players' results from anyone still
 * entering their own team), so a missing score renders as a dash rather than a
 * zero — "not shown to you" and "nil" are different things.
 */
export default function AroundTheGrounds({
  users,
  scoresByUser = {},
  liveUserIds = [],
  meId,
  scoresHidden = false,
  roundStarted = false,
  nextLockout = null,
  onSelect,
}) {
  const rows = Object.values(users || {});
  if (rows.length === 0) return null;

  const liveSet = new Set((liveUserIds || []).map(String));

  // Sort by score when scores are on show, otherwise by who's locked in.
  const ordered = [...rows].sort((a, b) => {
    if (!scoresHidden) {
      const sa = scoresByUser[a.userId] ?? -1;
      const sb = scoresByUser[b.userId] ?? -1;
      if (sa !== sb) return sb - sa;
    }
    const rank = { locked: 0, rolling: 1, open: 2 };
    if (rank[a.lockState] !== rank[b.lockState]) return rank[a.lockState] - rank[b.lockState];
    return String(a.name).localeCompare(String(b.name));
  });

  const lockedCount = rows.filter((r) => r.lockState === 'locked').length;
  const rollingCount = rows.filter((r) => r.lockState === 'rolling').length;

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500">
          Around the Grounds
        </h2>
        <span className="text-[11px] text-slate-400">
          {lockedCount} locked in
          {rollingCount > 0 && ` · ${rollingCount} still entering`}
          {nextLockout && ` · next lock ${nextLockout}`}
        </span>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-slate-200 bg-white shadow-sm">
        {ordered.map((row, i) => {
          const isMe = String(row.userId) === String(meId);
          const chip = LOCK_CHIP[row.lockState] || LOCK_CHIP.open;
          const score = scoresByUser[row.userId];
          const isLive = liveSet.has(String(row.userId));
          const incomplete = row.positionsFilled < row.positionsTotal;

          return (
            <button
              key={row.userId}
              type="button"
              onClick={onSelect ? () => onSelect(String(row.userId)) : undefined}
              disabled={!onSelect}
              className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 ${
                isMe ? 'bg-blue-50' : i % 2 ? 'bg-slate-50/40' : ''
              } ${onSelect ? 'hover:bg-slate-50' : 'cursor-default'}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[15px] leading-none">{TEAM_LOGOS[row.userId]}</span>
                <div className="min-w-0">
                  <div className={`truncate text-[13px] ${isMe ? 'font-extrabold text-blue-700' : 'font-semibold text-slate-700'}`}>
                    {row.name}{isMe ? ' (you)' : ''}
                  </div>
                  <div className="text-[10px] font-semibold text-slate-400">
                    {row.positionsFilled}/{row.positionsTotal} picked
                    {incomplete && row.lockState === 'locked' && ' · short'}
                    {row.submittedTips ? ' · tips in' : ''}
                  </div>
                </div>
              </div>

              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.06em] ${chip.cls}`}>
                {chip.label}
              </span>

              <span className="w-14 shrink-0 text-right text-[15px] font-black tabular-nums text-slate-900">
                {scoresHidden || score === undefined ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <>{isLive && <LiveDot />}{score}</>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {scoresHidden && roundStarted && (
        <p className="mt-2 px-1 text-[11px] text-slate-400">
          Everyone&apos;s scores open up once you&apos;ve got your own team in — submit before the
          first bounce and you&apos;ll see the lot from the opening game.
        </p>
      )}
    </section>
  );
}

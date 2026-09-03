'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppContext } from '@/app/context/AppContext';
import EntrantCard from '@/app/finals/components/EntrantCard';
import { LoadingSkeleton, ErrorCard, EmptyCard } from '@/app/finals/components/StatusCard';

// One stat in the header strip.
function HeaderStat({ label, value, valueClass = 'text-slate-100', labelClass = 'text-slate-400' }) {
  return (
    <div className="flex-1 text-center">
      <div className={`text-[19px] font-black leading-none tabular-nums ${valueClass}`}>{value}</div>
      <div className={`mt-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em] ${labelClass}`}>{label}</div>
    </div>
  );
}

/**
 * Duzza Finals results — your team's live score plus around the grounds, in the
 * same shape as the in-season mobile scoreboard.
 *
 * Other entrants' breakdowns come from the API only once the week has locked;
 * before that it returns just your own, so an empty "around the grounds" here
 * means "not yet revealed", not "nobody entered".
 */
export default function ResultsTab({ activeWeek, selectedEntrantId, weekLabel, fixturesKnown }) {
  const { selectedYear } = useAppContext();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async ({ background = false } = {}) => {
    if (activeWeek == null) return;
    try {
      background ? setRefreshing(true) : setLoading(true);
      setError(null);
      const res = await fetch(
        `/api/duzza-finals/results?round=${activeWeek}&detail=1&year=${selectedYear}`
      );
      if (!res.ok) throw new Error(`Failed to load results (${res.status})`);
      setDetail(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeWeek, selectedYear]);

  useEffect(() => { load(); }, [load]);

  // Keep a live week ticking over without the user pulling to refresh.
  const isLive = !!detail?.fixturesKnown && !detail?.roundComplete;
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => load({ background: true }), 120000);
    return () => clearInterval(id);
  }, [isLive, load]);

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error) return <ErrorCard message={error} onRetry={() => load()} />;
  if (!fixturesKnown || !detail?.fixturesKnown) {
    return (
      <EmptyCard title="Fixtures not locked in yet">
        Fixtures for {weekLabel || 'this week'} aren&apos;t confirmed yet — check back closer to game day.
      </EmptyCard>
    );
  }

  const entrants = detail.entrantDetails || [];
  const mine = entrants.find((e) => String(e.userId) === String(selectedEntrantId));
  const others = entrants
    .filter((e) => String(e.userId) !== String(selectedEntrantId))
    .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

  // Rank across everyone visible — meaningless while only your own entry is
  // showing, so it's suppressed until the week reveals the rest.
  const ranked = [...entrants].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
  const myRank = mine ? ranked.findIndex((e) => String(e.userId) === String(mine.userId)) + 1 : 0;
  const topScore = ranked.length > 0 ? ranked[0].totalScore || 0 : 0;
  const revealed = others.length > 0;

  return (
    <div className="space-y-4">
      {/* Live score strip — the at-a-glance header from the in-season scoreboard */}
      <div className="rounded-[18px] bg-gradient-to-br from-slate-900 via-slate-800 to-[#0b1120] px-4 py-3.5 text-white shadow-[0_14px_32px_-20px_rgba(15,23,42,0.6)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-400">
              {weekLabel || `Round ${activeWeek}`}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <h2 className="text-[22px] font-black leading-none tracking-[-0.02em]">Results</h2>
              {detail.roundComplete ? (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-emerald-300">
                  Final
                </span>
              ) : (
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-blue-300 animate-pulse">
                  ● Live
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => load({ background: true })}
            disabled={refreshing}
            aria-label="Refresh scores"
            className="shrink-0 rounded-full border border-white/15 p-2 text-slate-300 hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="mt-3 flex border-t border-white/10 pt-2.5">
          <HeaderStat
            label="Your score"
            value={mine ? mine.totalScore : '—'}
            valueClass="text-blue-300"
            labelClass="text-blue-300"
          />
          <div className="w-px bg-white/10" />
          <HeaderStat label="Top" value={revealed ? topScore : '—'} />
          <div className="w-px bg-white/10" />
          <HeaderStat
            label="Rank"
            value={revealed && myRank > 0 ? `${myRank}/${ranked.length}` : '—'}
            valueClass="text-amber-300"
            labelClass="text-amber-300"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 px-1 text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500">
          Your team
        </h3>
        {mine ? (
          <EntrantCard entrant={mine} expanded isSelf collapsible={false} />
        ) : (
          <EmptyCard title="No entry submitted">
            You didn&apos;t submit a team for {weekLabel || 'this week'}.
          </EmptyCard>
        )}
      </div>

      <div>
        <h3 className="mb-2 px-1 text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500">
          Around the grounds
        </h3>
        {others.length === 0 ? (
          <EmptyCard>Other teams are revealed at first bounce.</EmptyCard>
        ) : (
          <div className="space-y-2">
            {others.map((entrant) => (
              <EntrantCard
                key={entrant.userId}
                entrant={entrant}
                expanded={expandedId === entrant.userId}
                onToggle={() =>
                  setExpandedId((cur) => (cur === entrant.userId ? null : entrant.userId))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

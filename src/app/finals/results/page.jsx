'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useFinalsAuth } from '../context';
import useFinalsResults from '../lib/useFinalsResults';
import useFinalsRoundResults from '../lib/useFinalsRoundResults';
import { FINALS_ROUNDS, FALLBACK_WEEK_LABELS, weekNumberForRound } from '../lib/constants';
import { LoadingSkeleton, ErrorCard, EmptyCard } from '../components/StatusCard';
import EntrantCard from '../components/EntrantCard';

export default function ResultsPage() {
  const { entrantId } = useFinalsAuth();
  const { data: results } = useFinalsResults();

  const [activeWeek, setActiveWeek] = useState(FINALS_ROUNDS[0]);
  const [userChangedWeek, setUserChangedWeek] = useState(false);
  useEffect(() => {
    if (!userChangedWeek && results?.currentWeek && FINALS_ROUNDS.includes(results.currentWeek)) {
      setActiveWeek(results.currentWeek);
    }
  }, [results?.currentWeek, userChangedWeek]);

  const weekOptions = FINALS_ROUNDS.map((round) => {
    const apiWeek = (results?.weeks || []).find((w) => w.round === round);
    const label = apiWeek?.label || FALLBACK_WEEK_LABELS[round];
    return { round, display: `Week ${weekNumberForRound(round)} · ${label}` };
  });

  const { detail, loading, isRefreshing, error, lastUpdated, refresh } = useFinalsRoundResults(activeWeek, entrantId);
  const locked = !!detail?.locked;

  const [expandedId, setExpandedId] = useState(null);

  const entrantDetails = detail?.entrantDetails || [];
  const mine = entrantDetails.find((e) => String(e.userId) === String(entrantId));
  const others = entrantDetails
    .filter((e) => String(e.userId) !== String(entrantId))
    .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

  const isLive = detail?.fixturesKnown && locked && !detail?.roundComplete;

  return (
    <div className="space-y-4">
      <div className="dz-page-header mb-0">
        <div>
          <div className="dz-subtitle">
            {isLive && <span className="dz-badge bg-blue-100 text-blue-700 mr-2 animate-pulse">● Live</span>}
            {detail?.roundComplete && <span className="dz-badge bg-emerald-100 text-emerald-700 mr-2">Final</span>}
          </div>
          <h1 className="dz-title">Results</h1>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <select
            aria-label="Finals week"
            value={activeWeek}
            onChange={(e) => { setUserChangedWeek(true); setActiveWeek(Number(e.target.value)); }}
            className="dz-select min-w-0 flex-1"
          >
            {weekOptions.map((w) => <option key={w.round} value={w.round}>{w.display}</option>)}
          </select>
          <button
            type="button"
            onClick={refresh}
            disabled={loading || isRefreshing}
            title="Refresh live scores"
            className="dz-btn-ghost shrink-0"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div role="status" className="text-xs text-slate-500">
        {isRefreshing ? 'Updating scores…' : lastUpdated ? `Last refreshed ${lastUpdated.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}` : 'Loading scores…'}
        <span> · Auto-refresh every minute</span>
      </div>

      {error && detail && (
        <p role="alert" className="text-sm text-red-600">
          Couldn&apos;t refresh scores: {error}. Showing the last loaded results; try Refresh again.
        </p>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : error && !detail ? (
        <ErrorCard message={error} onRetry={refresh} />
      ) : !detail?.fixturesKnown ? (
        <EmptyCard title="Fixtures not locked in yet">
          Fixtures for this week aren&apos;t confirmed yet — check back closer to game day.
        </EmptyCard>
      ) : entrantId == null ? (
        <EmptyCard title="Sign in to see results">
          Register or log in from the Rules page to see your team&apos;s results, and everyone
          else&apos;s once the week locks.
        </EmptyCard>
      ) : (
        <>
          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500 mb-2 px-1">Your team</h2>
            {mine ? (
              <EntrantCard entrant={mine} expanded isSelf collapsible={false} />
            ) : (
              <EmptyCard title="No entry submitted">
                You didn&apos;t submit a team for this week.
              </EmptyCard>
            )}
          </div>

          <div>
            <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500 mb-2 px-1">Around the grounds</h2>
            {!locked ? (
              <EmptyCard>Other teams are revealed at first bounce.</EmptyCard>
            ) : others.length === 0 ? (
              <EmptyCard>No other entries yet.</EmptyCard>
            ) : (
              <div className="space-y-2">
                {others.map((entrant) => (
                  <EntrantCard
                    key={entrant.userId}
                    entrant={entrant}
                    expanded={expandedId === entrant.userId}
                    onToggle={() => setExpandedId((cur) => (cur === entrant.userId ? null : entrant.userId))}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

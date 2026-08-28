'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFinalsAuth } from '../context';
import useFinalsResults from '../lib/useFinalsResults';
import { fetchJSON } from '../lib/api';
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

  const [detail, setDetail] = useState(null); // {round, label, fixturesKnown, roundComplete, entrantDetails}
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (round) => {
    try {
      setLoading(true);
      setError(null);
      const [detailData, entryMeta] = await Promise.all([
        fetchJSON(`/api/duzza-finals/results?round=${round}&detail=1`),
        fetchJSON(`/api/duzza-finals/entry?round=${round}`),
      ]);
      setDetail(detailData);
      setLocked(!!entryMeta.locked);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(activeWeek); }, [activeWeek, load]);

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
        <select
          value={activeWeek}
          onChange={(e) => { setUserChangedWeek(true); setActiveWeek(Number(e.target.value)); }}
          className="dz-select"
        >
          {weekOptions.map((w) => <option key={w.round} value={w.round}>{w.display}</option>)}
        </select>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => load(activeWeek)} />
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

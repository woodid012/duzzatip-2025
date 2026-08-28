'use client';

import { useFinalsAuth } from '../context';
import useFinalsResults from '../lib/useFinalsResults';
import { LoadingSkeleton, ErrorCard } from '../components/StatusCard';
import LadderTable from '../components/LadderTable';
import BracketMini from '../components/BracketMini';

export default function LadderPage() {
  const { entrantId } = useFinalsAuth();
  const { data: results, loading, error, refresh } = useFinalsResults();

  const champions = results?.coChampions?.length
    ? results.coChampions
    : (results?.champion != null ? [results.champion] : []);
  const nameById = {};
  (results?.cumulativeLadder || []).forEach((e) => { nameById[e.userId] = e.name; });

  return (
    <div className="space-y-4">
      <div className="dz-page-header mb-0">
        <div>
          <div className="dz-subtitle">4-week cumulative total — open ladder</div>
          <h1 className="dz-title">Ladder</h1>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : error ? (
        <ErrorCard message={error} onRetry={refresh} />
      ) : (
        <>
          {results?.isComplete && champions.length > 0 && (
            <div className="rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-white p-5 shadow-sm text-center">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] opacity-90 mb-1">
                {champions.length > 1 ? 'Co-Champions' : 'Duzza Finals Champion'}
              </div>
              <div className="text-2xl font-black">
                {champions.map((uid) => nameById[uid] || uid).join('  ·  ')}
              </div>
            </div>
          )}

          <LadderTable cumulativeLadder={results?.cumulativeLadder} viewerId={entrantId} />

          <BracketMini
            weeks={results?.weeks}
            cumulativeLadder={results?.cumulativeLadder}
            champion={results?.champion}
            coChampions={results?.coChampions}
            isComplete={results?.isComplete}
          />
        </>
      )}
    </div>
  );
}

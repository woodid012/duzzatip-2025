'use client';

import { useRouter } from 'next/navigation';
import { useAppContext } from '@/app/context/AppContext';
import { CURRENT_YEAR } from '@/app/lib/constants';
import ScoreboardHeader from '@/app/components/ScoreboardHeader';
import { Trophy, ListOrdered, TrendingUp, CheckCircle2 } from 'lucide-react';

// Previous seasons with data to browse (current season excluded).
const PAST_SEASONS = [2025];

const VIEWS = [
  { label: 'Round Results', path: '/pages/results', Icon: Trophy },
  { label: 'Season Ladder', path: '/pages/ladder', Icon: ListOrdered },
  { label: 'Tipping Ladder', path: '/pages/tipping-ladder', Icon: TrendingUp },
  { label: 'Tip Results', path: '/pages/tipping-results', Icon: CheckCircle2 },
];

export default function PastSeasonsPage() {
  const { selectedYear, setSelectedYear } = useAppContext();
  const router = useRouter();

  // Switch the app into the chosen season (read-only) and open the view.
  const open = (year, path) => {
    setSelectedYear(year);
    router.push(path);
  };

  return (
    <div className="p-4 sm:p-6">
      <ScoreboardHeader eyebrow="Archive" title="Past Seasons" />

      {selectedYear !== CURRENT_YEAR && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <span>You&apos;re viewing the <strong>{selectedYear}</strong> season (read-only).</span>
          <button onClick={() => setSelectedYear(CURRENT_YEAR)} className="dz-btn-primary">
            Back to {CURRENT_YEAR} season
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {PAST_SEASONS.map((year) => (
          <div key={year} className="dz-surface p-5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-xl font-bold text-slate-900">{year} Season</h2>
              {selectedYear === year && (
                <span className="dz-badge bg-amber-100 text-amber-700">Viewing</span>
              )}
            </div>
            <p className="mb-4 text-sm text-slate-500">
              Browse the final results, ladders and tipping for {year}.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {VIEWS.map(({ label, path, Icon }) => (
                <button
                  key={path}
                  onClick={() => open(year, path)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

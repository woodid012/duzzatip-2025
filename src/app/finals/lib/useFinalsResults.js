'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';
import { readSnapshot, writeSnapshot } from '@/app/lib/clientSnapshot';

const SNAPSHOT_KEY = 'finals-results';

// GET /api/duzza-finals/results — the bracket/ladder payload every /finals
// page keys off (currentWeek default, weeks[], cumulativeLadder, champion).
// Shared here rather than fetched per-page so the four pages agree on the
// same snapshot within a navigation.
export default function useFinalsResults() {
  // Seeded from the last payload this tab saw so the four pages paint on
  // arrival; the refresh below still runs and replaces it.
  const [data, setData] = useState(() => readSnapshot(SNAPSHOT_KEY) ?? null);
  const hasDataRef = useRef(false);
  const [loading, setLoading] = useState(() => {
    hasDataRef.current = Boolean(readSnapshot(SNAPSHOT_KEY));
    return !hasDataRef.current;
  });
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      // Never put a skeleton over numbers already on screen.
      setLoading(!hasDataRef.current);
      setError(null);
      const body = await fetchJSON('/api/duzza-finals/results');
      setData(body);
      hasDataRef.current = true;
      writeSnapshot(SNAPSHOT_KEY, body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}

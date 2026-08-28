'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchJSON } from './api';

// GET /api/duzza-finals/results — the bracket/ladder payload every /finals
// page keys off (currentWeek default, weeks[], cumulativeLadder, champion).
// Shared here rather than fetched per-page so the four pages agree on the
// same snapshot within a navigation.
export default function useFinalsResults() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const body = await fetchJSON('/api/duzza-finals/results');
      setData(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}

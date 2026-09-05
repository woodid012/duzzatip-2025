'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJSON } from './api';

const REFRESH_INTERVAL_MS = 60 * 1000;
const EMPTY_RESULT = {
  detail: null,
  loading: true,
  isRefreshing: false,
  error: null,
  lastUpdated: null,
};

export default function useFinalsRoundResults(round, entrantId) {
  const [result, setResult] = useState(EMPTY_RESULT);
  const pendingRequest = useRef(null);

  const load = useCallback(async ({ force = false } = {}) => {
    // A slow refresh must finish before another one starts for this viewer/week.
    if (pendingRequest.current) return;
    const controller = new AbortController();
    pendingRequest.current = controller;

    setResult((previous) => {
      const current = previous.round === round && previous.entrantId === entrantId
        ? previous
        : EMPTY_RESULT;
      return {
        ...current,
        round,
        entrantId,
        loading: !current.detail,
        isRefreshing: !!current.detail,
        error: null,
      };
    });

    try {
      const detail = await fetchJSON(
        `/api/duzza-finals/results?round=${round}&detail=1${force ? '&refresh=1' : ''}`,
        { signal: controller.signal, cache: 'no-store' }
      );
      if (pendingRequest.current !== controller) return;
      setResult({ round, entrantId, detail, loading: false, isRefreshing: false, error: null, lastUpdated: new Date() });
    } catch (err) {
      if (pendingRequest.current !== controller || controller.signal.aborted) return;
      // Keep the last successful scores visible when a background fetch fails.
      setResult((previous) => ({ ...previous, loading: false, isRefreshing: false, error: err.message }));
    } finally {
      if (pendingRequest.current === controller) pendingRequest.current = null;
    }
  }, [round, entrantId]);

  useEffect(() => {
    load();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const interval = setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      pendingRequest.current?.abort();
      pendingRequest.current = null;
    };
  }, [load]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  // Hide the previous viewer/week immediately, before the new effect runs.
  const current = result.round === round && result.entrantId === entrantId ? result : EMPTY_RESULT;
  return { ...current, refresh };
}

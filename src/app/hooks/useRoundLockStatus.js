'use client'

import { useCallback, useEffect, useState } from 'react';

/**
 * Who's locked in for a round — and, for the signed-in player, whether they get
 * a firm lock (they submitted before the first bounce) or the rolling window
 * (they didn't). Carries no picks, so it's safe to hold on any page.
 *
 * Polls while a round is underway so a lock lands in the UI at roughly the same
 * time it lands on the server, rather than on the next full page load.
 */
export default function useRoundLockStatus(round, year, { pollMs = 60000 } = {}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal) => {
    if (round === null || round === undefined) return;
    try {
      const res = await fetch(`/api/round-lock-status?round=${round}&year=${year}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (!signal?.aborted) setStatus(data);
    } catch {
      // Supplementary to the page's own data — a miss just leaves the previous
      // status in place rather than blanking the panel.
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [round, year]);

  useEffect(() => {
    if (round === null || round === undefined) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [round, year, load]);

  // Only worth polling while the round is live: before the first bounce nothing
  // can lock, and once every game has started nothing more will.
  const live = !!status?.roundStarted && !status?.allGamesStarted;
  useEffect(() => {
    if (!live || !pollMs) return;
    const controller = new AbortController();
    const id = setInterval(() => load(controller.signal), pollMs);
    return () => { clearInterval(id); controller.abort(); };
  }, [live, pollMs, load]);

  const refresh = useCallback(() => load(), [load]);

  return {
    status,
    loading,
    refresh,
    // Convenience accessors — undefined until the first fetch lands.
    viewerSubmittedTeam: status?.viewer?.submittedTeam,
    viewerSubmittedTips: status?.viewer?.submittedTips,
    roundStarted: status?.roundStarted,
    users: status?.users,
  };
}

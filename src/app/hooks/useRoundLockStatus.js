'use client'

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

/**
 * Who's locked in for a round — and, for the signed-in player, whether they get
 * a firm lock (they submitted before the first bounce) or the rolling window
 * (they didn't). Carries no picks, so it's safe to hold on any page.
 *
 * Polls while a round is underway so a lock lands in the UI at roughly the same
 * time it lands on the server, rather than on the next full page load.
 *
 * One subscription per (round, year), shared by every mounted instance: the
 * shell's RoundStatus panel and a page's own hook used to each run their own
 * fetch and their own timer, so the team and tipping pages hit the endpoint
 * twice a minute. Polling also pauses while the tab is hidden and catches up
 * the moment it's visible again.
 */

const stores = new Map();
const SERVER_SNAPSHOT = { status: null, loading: true };

function getStore(round, year, pollMs) {
  const key = `${round}:${year}`;
  let store = stores.get(key);
  if (!store) {
    store = {
      url: `/api/round-lock-status?round=${round}&year=${year}`,
      snapshot: { status: null, loading: true },
      listeners: new Set(),
      inFlight: null,
      controller: null,
      timer: null,
      pollMs,
    };
    stores.set(key, store);
  }
  if (pollMs && (!store.pollMs || pollMs < store.pollMs)) store.pollMs = pollMs;
  return store;
}

function emit(store, patch) {
  store.snapshot = { ...store.snapshot, ...patch };
  store.listeners.forEach((listener) => listener());
}

function load(store) {
  // Concurrent callers (two instances mounting together, a poll landing on a
  // manual refresh) share the one request.
  if (store.inFlight) return store.inFlight;
  const controller = new AbortController();
  store.controller = controller;
  store.inFlight = (async () => {
    try {
      const res = await fetch(store.url, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (!controller.signal.aborted) emit(store, { status: data, loading: false });
    } catch {
      // Supplementary to the page's own data — a miss just leaves the previous
      // status in place rather than blanking the panel.
    } finally {
      if (store.controller === controller) store.controller = null;
      store.inFlight = null;
      if (!controller.signal.aborted) {
        if (store.snapshot.loading) emit(store, { loading: false });
        schedule(store);
      }
    }
  })();
  return store.inFlight;
}

// Only worth polling while the round is live: before the first bounce nothing
// can lock, and once every game has started nothing more will.
function isLive(status) {
  return !!status?.roundStarted && !status?.allGamesStarted;
}

function schedule(store) {
  if (store.timer) {
    clearInterval(store.timer);
    store.timer = null;
  }
  if (store.listeners.size === 0 || !store.pollMs || !isLive(store.snapshot.status)) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  store.timer = setInterval(() => load(store), store.pollMs);
}

let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    stores.forEach((store) => {
      if (store.listeners.size === 0) return;
      if (document.visibilityState === 'visible' && isLive(store.snapshot.status)) load(store);
      schedule(store);
    });
  });
}

export default function useRoundLockStatus(round, year, { pollMs = 60000 } = {}) {
  const hasRound = round !== null && round !== undefined;
  const store = useMemo(
    () => (hasRound ? getStore(round, year, pollMs) : null),
    [hasRound, round, year, pollMs]
  );

  const subscribe = useCallback((listener) => {
    if (!store) return () => {};
    bindVisibility();
    store.listeners.add(listener);
    if (!store.snapshot.status) load(store);
    schedule(store);
    return () => {
      store.listeners.delete(listener);
      if (store.listeners.size === 0) {
        schedule(store);
        store.controller?.abort();
      }
    };
  }, [store]);

  const snapshot = useSyncExternalStore(
    subscribe,
    () => (store ? store.snapshot : SERVER_SNAPSHOT),
    () => SERVER_SNAPSHOT
  );

  // A round change repoints at another store, whose data (if any) is what the
  // previous mount left there; kick a fresh read so it doesn't sit stale.
  useEffect(() => {
    if (store && store.snapshot.status && store.listeners.size > 0) load(store);
  }, [store]);

  const refresh = useCallback(() => (store ? load(store) : Promise.resolve()), [store]);

  const { status, loading } = snapshot;
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

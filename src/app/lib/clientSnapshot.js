'use client';

// src/app/lib/clientSnapshot.js
//
// Last-known payloads, so a page never shows a skeleton over data it already
// has. Mounting a hook used to reset its state to null, which meant every
// navigation went skeleton -> data even when the answer hadn't changed since
// the last visit a few seconds earlier. Seeding from the last payload paints
// immediately and lets the refetch happen behind what's on screen; the numbers
// only move when they actually differ.
//
// Two layers: a module-level Map, which survives client-side navigation within
// the session, and sessionStorage, which also survives a reload of the tab.
// Neither is a source of truth — every read is followed by a revalidation, and
// a miss just means the page loads the way it always did.

const memory = new Map();
const PREFIX = 'dz:snap:';

// Big payloads stay in memory only: serializing hundreds of KB on every poll
// costs more than the paint it saves.
const MAX_SESSION_BYTES = 512 * 1024;

function readSession(key) {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    // Private mode, blocked site data, or a half-written entry — treat as a miss.
    return undefined;
  }
}

/**
 * The last payload stored under `key`, or undefined.
 * `maxAgeMs` caps how old a snapshot may be before it's treated as a miss —
 * worth setting for anything a stale copy would visibly misrepresent.
 */
export function readSnapshot(key, { maxAgeMs } = {}) {
  const entry = memory.get(key) ?? readSession(key);
  if (!entry || typeof entry.at !== 'number') return undefined;
  if (maxAgeMs != null && Date.now() - entry.at > maxAgeMs) return undefined;

  memory.set(key, entry);
  return entry.value;
}

/**
 * Stores `value` as the last-known payload for `key`.
 * `session: false` keeps it in memory only, for anything that shouldn't outlive
 * the page session — a payload filtered for the current viewer, say, which a
 * different viewer in the same tab must not be able to read back.
 */
export function writeSnapshot(key, value, { session = true } = {}) {
  if (value === undefined) return;
  const entry = { value, at: Date.now() };
  memory.set(key, entry);

  if (!session || typeof window === 'undefined') return;
  try {
    const raw = JSON.stringify(entry);
    if (raw.length <= MAX_SESSION_BYTES) {
      window.sessionStorage.setItem(PREFIX + key, raw);
    }
  } catch {
    // Quota, private mode, or a value that won't serialize — memory still has it.
  }
}

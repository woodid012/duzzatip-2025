// src/app/lib/sharedCache.js
//
// A tiny TTL cache that lives in Mongo rather than in one lambda's memory.
//
// Every derived-value cache in this app used to be a module-level Map, which on
// a serverless host means one cache per instance. Two requests seconds apart
// land on differently-warmed instances, so a cold one pays the full cost (an
// AFL API handshake, a whole bracket recomputation) and — worse — can answer
// differently from the instance that served the request before it. That is what
// made the finals bracket flip between states as it polled.
//
// This keeps the in-process caches as the fast path and puts a shared layer
// behind them, so instances agree and only the first one pays.
//
// Failing to read or write the cache is never fatal: a cache miss just means
// the caller computes the value, which is what it did before this existed.

import { connectToDatabase } from '@/app/lib/mongodb';

const COLLECTION = 'derived_cache';

// Mongo expires documents itself once expiresAt passes (expireAfterSeconds: 0),
// so nothing here has to sweep. Reads still check expiresAt because the sweep
// runs about once a minute, which is looser than some of these TTLs.
let indexEnsured = false;
async function collection() {
  const { db } = await connectToDatabase();
  const col = db.collection(COLLECTION);
  if (!indexEnsured) {
    indexEnsured = true; // set first so a slow build doesn't re-trigger
    try {
      await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });
    } catch (err) {
      indexEnsured = false;
      console.warn(`[shared-cache] ensure TTL index failed: ${err.message}`);
    }
  }
  return col;
}

// The cached value, or undefined for a miss. undefined is the miss signal
// rather than null so a legitimately null/false value still counts as a hit.
export async function getShared(key) {
  try {
    const doc = await (await collection()).findOne({ _id: key });
    if (!doc) return undefined;
    if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) return undefined;
    return doc.value;
  } catch (err) {
    console.warn(`[shared-cache] read ${key} failed: ${err.message}`);
    return undefined;
  }
}

export async function setShared(key, value, ttlMs) {
  try {
    const now = new Date();
    await (await collection()).updateOne(
      { _id: key },
      { $set: { value, updatedAt: now, expiresAt: new Date(now.getTime() + ttlMs) } },
      { upsert: true }
    );
  } catch (err) {
    console.warn(`[shared-cache] write ${key} failed: ${err.message}`);
  }
}

// Read-through: serve a fresh shared value, otherwise compute one and share it.
// `compute` runs at most once per instance per miss; two instances missing at
// the same moment both compute, which is the accepted cost of not holding a
// lock — the value is derived, so either answer is valid.
export async function withShared(key, ttlMs, compute) {
  const hit = await getShared(key);
  if (hit !== undefined) return hit;

  const value = await compute();
  await setShared(key, value, ttlMs);
  return value;
}

// A stamp is the cheap case: "has anyone done this lately?". Claiming it
// returns true for the caller that should do the work and false for everyone
// arriving inside the window.
export async function claimStamp(key, ttlMs) {
  if ((await getShared(key)) !== undefined) return false;
  await setShared(key, Date.now(), ttlMs);
  return true;
}

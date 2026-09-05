'use client';

const FLAG = 'dz_finals_opened';

// True for exactly one caller per app session — the page the session opened
// on. The finals layout claims it on mount for every page, and effects run
// child-first, so a page that wants to know whether it *is* the app's opening
// screen (rather than a later click on its nav tab) can claim it first.
// Storage unavailable → nobody claims it, so no redirect can loop.
export function claimFirstOpen() {
  try {
    if (sessionStorage.getItem(FLAG)) return false;
    sessionStorage.setItem(FLAG, '1');
    return true;
  } catch {
    return false;
  }
}

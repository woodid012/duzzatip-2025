// Client-safe display constants for both finals UIs (the standalone /finals
// app and /pages/duzza-finals). Kept apart from the backend-owned
// src/app/lib/duzzaFinals.js, which pulls in server-only modules.
// The API's own per-week `label` is always preferred once it's loaded; these
// are just what renders before that first response lands.
export const FINALS_ROUNDS = [26, 27, 28, 29];

export const FALLBACK_WEEK_LABELS = {
  26: 'Qualifying & Elimination Finals',
  27: 'Semi Finals',
  28: 'Preliminary Finals',
  29: 'Grand Final',
};

// Only the two weeks the brief gives explicit dates for — the middle two
// shift with how the finals fall, and stay "fixtures TBC" until AFL confirms
// them anyway.
export const WEEK_DATE_HINTS = {
  26: 'Sep 3–5',
  27: null,
  29: 'Sep 26',
};

export const weekNumberForRound = (round) => round - 25;

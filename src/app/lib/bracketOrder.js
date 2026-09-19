// src/app/lib/bracketOrder.js
//
// How the Duzza Finals bracket reads: newest week first. The week being played
// leads, then the week before it, and so on back to Week 1 — the interesting
// column is always the one you land on.
//
// A week that hasn't started yet isn't shown at all, which is what keeps the
// Grand Final out of the bracket until it's the live week rather than sitting
// there empty for a month. `currentWeek` is the bracket's own idea of the live
// round (the earliest round still to play out); once the comp is decided it
// parks on the last round, so a finished bracket shows every week.
//
// Pure and dependency-free so both the main app's Bracket tab and the
// standalone finals app can share it without either pulling in server code.
export function orderBracketWeeks(weeks, currentWeek) {
  const parsed = currentWeek == null ? NaN : Number(currentWeek);
  const upTo = Number.isFinite(parsed) ? parsed : null;

  return [...(weeks || [])]
    .filter((week) => upTo === null || week.round <= upTo)
    .sort((a, b) => b.round - a.round);
}

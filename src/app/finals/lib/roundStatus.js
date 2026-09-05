// Shared "is this finals week actually being played right now" check, keyed
// off the per-week flags the bracket payload (/api/duzza-finals/results)
// already carries. Both finals interfaces — the core app's /pages/duzza-finals
// tabs and this standalone /finals app — land on their results view while it
// holds, since live scores are what you open the app for mid-round.
export function isWeekInProgress(week) {
  return !!week && !!week.fixturesKnown && !!week.roundCommenced && !week.roundComplete;
}

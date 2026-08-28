// Client-safe (no DB imports) window check for the Duzza Finals period —
// while it's on, the app's default landing page becomes the finals interface.
// Deliberately date-based rather than fixture-based so it works before the
// finals rounds land in the fixtures collection.
export const DUZZA_FINALS_HOME_START = Date.UTC(2026, 7, 25); // 25 Aug 2026
export const DUZZA_FINALS_HOME_END = Date.UTC(2026, 8, 30); // 30 Sep 2026 (GF is 26 Sep)

export function isDuzzaFinalsWindow(date = new Date()) {
  const t = date.getTime();
  return t >= DUZZA_FINALS_HOME_START && t <= DUZZA_FINALS_HOME_END;
}

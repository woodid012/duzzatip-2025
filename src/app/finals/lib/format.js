// Display-only date formatting for the standalone Finals app. Raw fixtures
// from /api/tipping-data only carry DateUtc — the main app's DateMelb field
// is computed client-side by AppContext's processFixtures, which this app
// deliberately doesn't depend on, so we compute our own here.
export function formatMelbDate(dateUtc, opts = {}) {
  if (!dateUtc) return '';
  try {
    return new Date(dateUtc).toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      ...opts,
    });
  } catch {
    return '';
  }
}

'use client';

// Shared "can't show the picker" states for the Team/Tips/merged Enter views —
// centralised so the messaging (and the order the checks run in) stays
// identical across the desktop tabs and the mobile merged tab.
export default function EntryGuard({ isAdmin, selectedEntrantId, poolLoading, fixturesKnown, isEligibleThisWeek }) {
  if (!selectedEntrantId) {
    return (
      <div className="dz-surface p-6 text-center text-slate-500">
        {isAdmin ? 'Select a player above to view or edit their entry.' : 'Select a player to continue.'}
      </div>
    );
  }

  if (!poolLoading && !fixturesKnown) {
    return (
      <div className="dz-surface p-8 text-center">
        <div className="text-3xl mb-2">🏉</div>
        <h3 className="dz-title mb-1">Fixtures not locked in yet</h3>
        <p className="dz-subtitle">Fixtures for this week aren&apos;t locked in yet — check back closer to game day.</p>
      </div>
    );
  }

  if (!isAdmin && !isEligibleThisWeek) {
    return (
      <div className="dz-surface p-6 text-center text-slate-500">
        You weren&apos;t alive for this week of Duzza Finals.
      </div>
    );
  }

  return null;
}

// True when EntryGuard would block rendering — lets a parent decide whether
// to bother rendering the picker content at all.
export function isBlocked({ selectedEntrantId, poolLoading, fixturesKnown, isAdmin, isEligibleThisWeek }) {
  if (!selectedEntrantId) return true;
  if (!poolLoading && !fixturesKnown) return true;
  if (!isAdmin && !isEligibleThisWeek) return true;
  return false;
}

'use client';

import { useAppContext } from '@/app/context/AppContext';
import { isRoundFullyLocked, nextLockoutTime } from '@/app/lib/rollingLockout';
import useRoundLockStatus from '@/app/hooks/useRoundLockStatus';

export default function RoundStatus() {
  const { roundInfo, fixtures, loading, isPastYear, selectedYear } = useAppContext();
  const { viewerSubmittedTeam, viewerSubmittedTips, roundStarted } =
    useRoundLockStatus(roundInfo?.currentRound, selectedYear);

  if (isPastYear || loading.fixtures || !roundInfo || roundInfo.currentRound === undefined) {
    return null;
  }

  const roundDisplay = roundInfo.currentRoundDisplay || `Round ${roundInfo.currentRound}`;

  // Nothing left to nudge about once every game has started.
  const fullyLocked = isRoundFullyLocked(fixtures || [], roundInfo.currentRound);
  if (fullyLocked) return null;

  // Nor once this player is committed: they got their picks in before the
  // bounce, so the round is settled for them even though games remain.
  const started = !!roundStarted;
  if (started && viewerSubmittedTeam && viewerSubmittedTips) return null;

  const nextLock = nextLockoutTime(fixtures || [], roundInfo.currentRound);

  // Calculate time until the next thing locks
  let lockInfo = '';
  if (nextLock) {
    const diffMs = nextLock - new Date();

    if (diffMs > 0) {
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHrs = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      if (diffDays > 0) {
        lockInfo = `next lock in ${diffDays}d ${diffHrs}h`;
      } else if (diffHrs > 0) {
        const diffMin = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        lockInfo = `next lock in ${diffHrs}h ${diffMin}m`;
      } else {
        const diffMin = Math.floor(diffMs / (1000 * 60));
        lockInfo = `next lock in ${diffMin}m`;
      }
    }
  }

  // Once the round is under way, only a player who missed the deadline still has
  // anything to enter — and only for games yet to start.
  const lead = started
    ? `${roundDisplay} — games still to come are open`
    : `${roundDisplay} — tips & teams due`;
  const statusText = `${lead}${lockInfo ? ` · ${lockInfo}` : ''}`;

  return (
    <div className={`${started ? 'bg-amber-600' : 'bg-green-600'} text-white text-center py-1.5 text-sm font-medium`}>
      {statusText}
    </div>
  );
}

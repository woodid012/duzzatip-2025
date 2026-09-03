'use client';

import { useAppContext } from '@/app/context/AppContext';
import { isRoundFullyLocked, nextLockoutTime } from '@/app/lib/rollingLockout';

export default function RoundStatus() {
  const { roundInfo, fixtures, loading, isPastYear } = useAppContext();

  if (isPastYear || loading.fixtures || !roundInfo || roundInfo.currentRound === undefined) {
    return null;
  }

  const roundDisplay = roundInfo.currentRoundDisplay || `Round ${roundInfo.currentRound}`;

  // Rolling lockout: the round shuts one game at a time, so the reminder stays
  // up for as long as anything is still gettable — it only goes away once every
  // game has started and there's nothing left to get in.
  const fullyLocked = isRoundFullyLocked(fixtures || [], roundInfo.currentRound);
  if (fullyLocked) return null;

  const nextLock = nextLockoutTime(fixtures || [], roundInfo.currentRound);
  const started = !!nextLock && !!roundInfo.lockoutDate && nextLock > new Date(roundInfo.lockoutDate);

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

  const lead = started
    ? `${roundDisplay} — remaining tips & teams still open`
    : `${roundDisplay} — tips & teams due`;
  const statusText = `${lead}${lockInfo ? ` · ${lockInfo}` : ''}`;

  return (
    <div className={`${started ? 'bg-amber-600' : 'bg-green-600'} text-white text-center py-1.5 text-sm font-medium`}>
      {statusText}
    </div>
  );
}

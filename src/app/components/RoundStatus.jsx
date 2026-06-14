'use client';

import { useAppContext } from '@/app/context/AppContext';

export default function RoundStatus() {
  const { roundInfo, loading, isPastYear } = useAppContext();

  if (isPastYear || loading.fixtures || !roundInfo || roundInfo.currentRound === undefined) {
    return null;
  }

  const isLocked = roundInfo.isLocked;
  const roundDisplay = roundInfo.currentRoundDisplay || `Round ${roundInfo.currentRound}`;

  // The banner exists only to remind people to get their tips & teams in before
  // lockout. Once the round is locked (in progress / complete) it isn't needed.
  if (isLocked) return null;

  // Calculate time until lockout
  let lockInfo = '';
  if (roundInfo.lockoutDate) {
    const now = new Date();
    const lockout = new Date(roundInfo.lockoutDate);
    const diffMs = lockout - now;

    if (diffMs > 0) {
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHrs = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      if (diffDays > 0) {
        lockInfo = `locks in ${diffDays}d ${diffHrs}h`;
      } else if (diffHrs > 0) {
        const diffMin = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        lockInfo = `locks in ${diffHrs}h ${diffMin}m`;
      } else {
        const diffMin = Math.floor(diffMs / (1000 * 60));
        lockInfo = `locks in ${diffMin}m`;
      }
    }
  }

  const statusText = `${roundDisplay} \u2014 tips & teams due${lockInfo ? ` \u00b7 ${lockInfo}` : ''}`;

  return (
    <div className="bg-green-600 text-white text-center py-1.5 text-sm font-medium">
      {statusText}
    </div>
  );
}

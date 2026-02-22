'use client';

import { useAppContext } from '@/app/context/AppContext';

export default function RoundStatus() {
  const { roundInfo, loading, isPastYear } = useAppContext();

  if (isPastYear || loading.fixtures || !roundInfo || roundInfo.currentRound === undefined) {
    return null;
  }

  const isLocked = roundInfo.isLocked;
  const roundDisplay = roundInfo.currentRoundDisplay || `Round ${roundInfo.currentRound}`;

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

  // Determine status
  let statusText, bgColor;
  if (isLocked && roundInfo.roundEndDate) {
    const now = new Date();
    const roundEnd = new Date(roundInfo.roundEndDate);
    if (now < roundEnd) {
      statusText = `${roundDisplay} \u2014 In Progress`;
      bgColor = 'bg-blue-600';
    } else {
      statusText = `${roundDisplay} \u2014 Complete`;
      bgColor = 'bg-gray-600';
    }
  } else if (isLocked) {
    statusText = `${roundDisplay} \u2014 Locked`;
    bgColor = 'bg-red-600';
  } else {
    statusText = `${roundDisplay} \u2014 Open${lockInfo ? ` (${lockInfo})` : ''}`;
    bgColor = 'bg-green-600';
  }

  if (roundInfo.lockoutTime && isLocked) {
    statusText += ` (started ${roundInfo.lockoutTime})`;
  }

  return (
    <div className={`${bgColor} text-white text-center py-1.5 text-sm font-medium`}>
      {statusText}
    </div>
  );
}

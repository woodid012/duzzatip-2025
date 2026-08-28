'use client';

import EntryGuard from './EntryGuard';
import MyTeamTab from './MyTeamTab';
import TipsTab from './TipsTab';

// Mobile-only merged "Enter" tab — team slots then tip cards, one combined
// save flow (a single POST carrying both `team` and `tips`, via the hook's
// saveEntry). Desktop keeps Team and Tips as separate tabs/saves.
export default function EnterTab({
  isAdmin,
  selectedEntrantId,
  fixturesKnown,
  poolLoading,
  isEligibleThisWeek,
  entryLocked,
  isPastYear,
  canEdit,
  saving,
  teamsPlaying,
  playersByTeam,
  team,
  handlePlayerChange,
  handleBackupPositionChange,
  weekFixtures,
  tips,
  handleTipSelect,
  handleDeadCertToggle,
  isEditingEntry,
  entryDirty,
  startEditingEntry,
  cancelEditingEntry,
  saveEntry,
}) {
  const guard = (
    <EntryGuard
      isAdmin={isAdmin}
      selectedEntrantId={selectedEntrantId}
      poolLoading={poolLoading}
      fixturesKnown={fixturesKnown}
      isEligibleThisWeek={isEligibleThisWeek}
    />
  );
  if (guard) return guard;

  const sharedProps = { isAdmin, selectedEntrantId, fixturesKnown, poolLoading, isEligibleThisWeek, embedded: true };

  return (
    <div className="space-y-4">
      {teamsPlaying?.length > 0 && (
        <div className="text-xs text-slate-500 px-1">
          Clubs playing this week: <span className="font-medium text-slate-700">{teamsPlaying.join(', ')}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-bold text-slate-900">Your Entry</h2>
        <div className="flex items-center gap-2">
          {isEditingEntry ? (
            <>
              <button
                onClick={saveEntry}
                disabled={saving || !entryDirty}
                className="dz-btn-primary bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={cancelEditingEntry} className="dz-btn-ghost">Cancel</button>
            </>
          ) : (
            <button
              onClick={startEditingEntry}
              disabled={!canEdit}
              className={`dz-btn ${canEdit ? 'dz-btn-primary' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
            >
              {isPastYear ? 'Read only' : entryLocked && !isAdmin ? 'Locked' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {entryLocked && !isAdmin && (
        <div className="rounded-xl bg-slate-100 border border-slate-200 text-slate-600 p-3 text-sm font-medium">
          🔒 This week is locked — the first game has bounced. Your team and tips are final for this week.
        </div>
      )}

      <MyTeamTab
        {...sharedProps}
        playersByTeam={playersByTeam}
        team={team}
        isEditingTeam={isEditingEntry}
        handlePlayerChange={handlePlayerChange}
        handleBackupPositionChange={handleBackupPositionChange}
      />

      <TipsTab
        {...sharedProps}
        weekFixtures={weekFixtures}
        tips={tips}
        isEditingTips={isEditingEntry}
        handleTipSelect={handleTipSelect}
        handleDeadCertToggle={handleDeadCertToggle}
      />
    </div>
  );
}

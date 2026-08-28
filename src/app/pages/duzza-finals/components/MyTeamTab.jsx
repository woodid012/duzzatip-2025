'use client';

import { POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';
import PlayerSelect from './PlayerSelect';
import EntryGuard, { isBlocked } from './EntryGuard';

const getPositionDisplay = (position) => {
  if (position === 'Reserve A') return 'Reserve A';
  if (position === 'Reserve B') return 'Reserve B';
  return position;
};

export default function MyTeamTab({
  isAdmin,
  selectedEntrantId,
  fixturesKnown,
  teamsPlaying,
  playersByTeam,
  poolLoading,
  team,
  isEditingTeam,
  teamDirty,
  canEdit,
  entryLocked,
  isEligibleThisWeek,
  isPastYear,
  startEditingTeam,
  cancelEditingTeam,
  saveTeam,
  handlePlayerChange,
  handleBackupPositionChange,
  saving,
  embedded = false,
}) {
  if (!embedded) {
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
  } else if (isBlocked({ isAdmin, selectedEntrantId, poolLoading, fixturesKnown, isEligibleThisWeek })) {
    // Parent (the merged mobile Enter tab) already rendered the guard.
    return null;
  }

  return (
    <div className="space-y-4">
      {!embedded && teamsPlaying?.length > 0 && (
        <div className="text-xs text-slate-500 px-1">
          Clubs playing this week: <span className="font-medium text-slate-700">{teamsPlaying.join(', ')}</span>
        </div>
      )}

      {!embedded && entryLocked && !isAdmin && (
        <div className="rounded-xl bg-slate-100 border border-slate-200 text-slate-600 p-3 text-sm font-medium">
          🔒 This week is locked — the first game has bounced. Your team is final for this week.
        </div>
      )}

      <div className={embedded ? '' : 'dz-surface p-3 sm:p-4'}>
        {!embedded && (
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="text-lg font-bold text-slate-900">Your Team</h2>
            <div className="flex items-center gap-2">
              {isEditingTeam ? (
                <>
                  <button
                    onClick={saveTeam}
                    disabled={saving || !teamDirty}
                    className="dz-btn-primary bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save Team'}
                  </button>
                  <button onClick={cancelEditingTeam} className="dz-btn-ghost">Cancel</button>
                </>
              ) : (
                <button
                  onClick={startEditingTeam}
                  disabled={!canEdit}
                  className={`dz-btn ${canEdit ? 'dz-btn-primary' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
                >
                  {isPastYear ? 'Read only' : entryLocked && !isAdmin ? 'Locked' : 'Edit Team'}
                </button>
              )}
            </div>
          </div>
        )}
        {embedded && (
          <h3 className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500 mb-2 px-1">Your Team</h3>
        )}

        <div className={embedded ? 'space-y-2 dz-surface p-3' : 'space-y-2'}>
          {POSITION_TYPES.map((position) => {
            const slot = team?.[position] || {};
            return (
              <div key={position} className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-900">{getPositionDisplay(position)}</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  {isEditingTeam ? (
                    <>
                      <PlayerSelect
                        playersByTeam={playersByTeam}
                        value={slot.player ? { player: slot.player, club: slot.club } : null}
                        onChange={(player, club) => handlePlayerChange(position, player, club)}
                        className="w-full"
                      />
                      {position === 'Bench' && (
                        <select
                          value={slot.backup_position || ''}
                          onChange={(e) => handleBackupPositionChange(e.target.value)}
                          className="dz-select w-full sm:w-1/3 text-sm"
                        >
                          <option value="">Backup Position</option>
                          {BACKUP_POSITIONS.map((pos) => (
                            <option key={pos} value={pos}>{pos}</option>
                          ))}
                        </select>
                      )}
                    </>
                  ) : (
                    <div className="w-full p-2 text-sm border rounded bg-white border-slate-200">
                      {slot.player ? (
                        <div className="flex justify-between items-center gap-2">
                          <span className="min-w-0 truncate text-slate-900">
                            {slot.player} <span className="text-slate-400">({slot.club})</span>
                          </span>
                          {position === 'Bench' && slot.backup_position && (
                            <span className="text-xs shrink-0 text-slate-500">{slot.backup_position}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

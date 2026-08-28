'use client';

import { POSITION_TYPES, BACKUP_POSITIONS } from '@/app/lib/constants';
import PlayerSelect from './PlayerSelect';

// The 9 team slots (6 scoring positions + Bench + Reserve A + Reserve B).
// `team` is { [position]: { player, club, backup_position? } }.
export default function TeamSlots({ playersByTeam, team, onPlayerChange, onBackupChange, disabled }) {
  return (
    <div className="space-y-2.5">
      {POSITION_TYPES.map((position) => {
        const slot = team?.[position] || {};
        return (
          <div key={position} className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-slate-800">{position}</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <PlayerSelect
                playersByTeam={playersByTeam}
                value={slot.player ? { player: slot.player, club: slot.club } : null}
                onChange={(player, club) => onPlayerChange(position, player, club)}
                disabled={disabled}
                className="w-full"
              />
              {position === 'Bench' && (
                <select
                  value={slot.backup_position || ''}
                  onChange={(e) => onBackupChange(e.target.value)}
                  disabled={disabled}
                  className="dz-select w-full sm:w-44 text-sm"
                >
                  <option value="">Backup position</option>
                  {BACKUP_POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

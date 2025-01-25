'use client'

import { POSITION_TYPES, TEAM_NAMES, CURRENT_YEAR } from '@/app/lib/constants';

export default function ResultCard({ user, teamSelection, results }) {
  const calculatePositionTotal = () => {
    return Object.values(results).reduce((total, pos) => total + (pos.points || 0), 0);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 grid grid-rows-[auto_1fr]">
      <div className="mb-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold">{TEAM_NAMES[user]}</h2>
          <div className="text-2xl font-bold text-blue-600">
            {calculatePositionTotal()} pts
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {POSITION_TYPES.map(position => {
          const playerData = teamSelection[position];
          const resultData = results[position];
          const isBenchSubstituted = resultData?.substituted;

          return (
            <div 
              key={position} 
              className={`p-3 rounded ${
                isBenchSubstituted ? 'bg-green-50 border border-green-200' : 'bg-gray-50'
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="font-medium">{position}</span>
                {resultData?.points !== undefined && (
                  <span className={`font-bold ${
                    isBenchSubstituted ? 'text-green-600' : 'text-blue-600'
                  }`}>
                    {resultData.points} pts
                  </span>
                )}
              </div>

              <div className="text-sm">
                {playerData?.player_name || 'Not Selected'}
                {position === 'Bench' && playerData?.backup_position && (
                  <span className="text-gray-500 ml-2">
                    (Backup: {playerData.backup_position})
                  </span>
                )}
                {isBenchSubstituted && (
                  <span className="text-green-600 ml-2">
                    (Substituted In)
                  </span>
                )}
              </div>

              {resultData?.breakdown && resultData.breakdown.length > 0 && (
                <div className="mt-2 pl-2 text-xs text-gray-600 border-l-2 border-gray-200">
                  {resultData.breakdown.map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
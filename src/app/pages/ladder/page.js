'use client'

import { useState } from 'react';
import { USER_NAMES } from '@/app/lib/constants';
import useLadder from '@/app/hooks/useLadder';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

export default function LadderPage() {
  const { 
    ladder, 
    loading, 
    error, 
    changeRound, 
    isFinalRound, 
    getFinalRoundName,
    currentRound 
  } = useLadder();

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    changeRound(newRound);
  };

  // Display loading state
  if (loading) {
    return <div className="p-4">Loading ladder...</div>;
  }
  
  // Display error state
  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-black">Season Ladder</h1>
        <div className="w-full sm:w-auto flex items-center gap-2">
          <label htmlFor="round-select" className="text-sm font-medium text-black">Up to Round:</label>
          <select 
            id="round-select"
            value={currentRound}
            onChange={handleRoundChange}
            className="p-2 border rounded w-24 text-lg text-black"
          >
            {[...Array(25)].map((_, i) => (
              <option key={i} value={i}>{i === 0 ? 'Opening' : i}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Finals banner for rounds 22-24 */}
      {isFinalRound(currentRound) && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h2 className="text-xl font-semibold text-yellow-800">
            Finals Series: {getFinalRoundName(currentRound)}
          </h2>
          <p className="text-yellow-700">
            {currentRound === 22 && "Top team plays 4th, 2nd plays 3rd. Winners advance to preliminary & grand finals."}
            {currentRound === 23 && "Winner from Qualifying Final 2 plays the loser from Qualifying Final 1."}
            {currentRound === 24 && "Grand Final - Winner takes all!"}
          </p>
        </div>
      )}

      {/* Ladder table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pos</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">P</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">L</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">D</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PF</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PA</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">%</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Pts</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {ladder.map((team, index) => (
              <tr key={team.userId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {index + 1}
                  {index === 0 && <span className="ml-1 text-green-600">•</span>}
                  {index >= 1 && index <= 3 && <span className="ml-1 text-blue-600">•</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {team.userName}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.played}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.wins}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.losses}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.draws}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.pointsFor}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.pointsAgainst}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.percentage}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-medium text-gray-900">{team.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 text-sm text-gray-600">
        <div className="flex gap-4">
          <div><span className="inline-block w-2 h-2 rounded-full bg-green-600 mr-1"></span> Top position (automatic Grand Final)</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-blue-600 mr-1"></span> Finals positions (2-4)</div>
        </div>
        <div className="mt-2">
          <span className="font-medium">P</span>: Played, 
          <span className="font-medium ml-2">W</span>: Wins, 
          <span className="font-medium ml-2">L</span>: Losses, 
          <span className="font-medium ml-2">D</span>: Draws, 
          <span className="font-medium ml-2">PF</span>: Points For, 
          <span className="font-medium ml-2">PA</span>: Points Against, 
          <span className="font-medium ml-2">%</span>: Percentage, 
          <span className="font-medium ml-2">Pts</span>: Ladder Points (Win: 4, Draw: 2, Loss: 0)
        </div>
      </div>
    </div>
  );
}
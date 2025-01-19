'use client'

import React from 'react';
import { POSITIONS } from '../lib/scoring_rules';

const TeamCard = ({ team }) => {
  const playerScores = team.players.map(player => ({
    position: POSITIONS[player.position].name,
    score: POSITIONS[player.position].calculation(player.stats).total
  }));

  const mainTeamScore = playerScores.reduce((total, player) => total + player.score, 0);
  const backupScore = POSITIONS[team.bench.backup.position].calculation(team.bench.backup.stats).total;
  const reserveScores = team.bench.reserves.map(reserve => ({
    position: POSITIONS[reserve.position].name,
    score: POSITIONS[reserve.position].calculation(reserve.stats).total
  }));
  
  const deadCerts = 0;
  const totalScore = mainTeamScore + deadCerts;

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm">
      <h2 className="text-xl font-bold text-center text-gray-800 pb-4 border-b border-gray-200">
        {team.name}
      </h2>
      
      <div className="space-y-3 mt-4">
        <div className="grid gap-2">
          <div className="flex justify-between items-center bg-gray-50 p-3 rounded-md">
            <span className="text-gray-600">Player Score:</span>
            <span className="font-bold text-gray-800">{mainTeamScore}</span>
          </div>
          <div className="flex justify-between items-center bg-gray-50 p-3 rounded-md">
            <span className="text-gray-600">Dead Certs:</span>
            <span className="font-bold text-gray-800">{deadCerts}</span>
          </div>
          <div className="flex justify-between items-center bg-blue-50 p-3 rounded-md">
            <span className="text-gray-600 font-semibold">Total Score:</span>
            <span className="font-bold text-gray-800">{totalScore}</span>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-3">Starting Players</h3>
          <div className="space-y-2">
            {team.players.map((player, index) => (
              <div key={index} className="grid grid-cols-3 gap-2 bg-gray-50 p-2 rounded-md hover:bg-gray-100 transition-colors">
                <span className="text-gray-600">{POSITIONS[player.position].name}</span>
                <span className="text-gray-600">{player.name || '(No name)'}</span>
                <span className="font-semibold text-gray-800 text-right">{POSITIONS[player.position].calculation(player.stats).total}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-3">Bench</h3>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2 rounded-md">
              <span className="text-gray-600">{POSITIONS[team.bench.backup.position].name}</span>
              <span className="text-gray-600">{team.bench.backup.name || '(No name)'}</span>
              <span className="font-semibold text-gray-800 text-right">{backupScore}</span>
            </div>
            {team.bench.reserves.map((reserve, index) => (
              <div key={index} className="grid grid-cols-3 gap-2 bg-gray-50 p-2 rounded-md">
                <span className="text-gray-600">{POSITIONS[reserve.position].name}</span>
                <span className="text-gray-600">{reserve.name || '(No name)'}</span>
                <span className="font-semibold text-gray-800 text-right">
                  {POSITIONS[reserve.position].calculation(reserve.stats).total}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamCard;
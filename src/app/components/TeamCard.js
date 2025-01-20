'use client'

import React from 'react';
import { POSITIONS } from '@/app/lib/scoring_rules';

const getUserName = (userId) => {
  const userNames = {
    1: "User 1",
    2: "User 2",
    3: "User 3",
    4: "User 4",
    5: "User 5",
    6: "User 6",
    7: "User 7",
    8: "User 8"
  };
  return userNames[userId] || `User ${userId}`;
};

const TeamCard = ({ team, userId }) => {
  // Early return if team is not provided
  if (!team) return null;

  // Transform team selection data into player scores
  const playerScores = Object.entries(team).map(([position, playerData]) => {
    // Include bench players with their backup position
    const displayPosition = position === 'Bench' 
      ? `Bench (${playerData.backup_position || 'No backup set'})`
      : position;
    
    return {
      position: displayPosition,
      playerName: playerData.player_name,
      // We'll need to add score calculation once we have stats data
      // score: POSITIONS[position].calculation(playerData.stats).total
      score: 0 // Placeholder until we have stats
    };
  }).filter(Boolean); // Remove null entries (bench players)

  return (
    <div className="flex-1 bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">{getUserName(userId)}</h3>
      <div className="space-y-4">
        {playerScores.map((player, index) => (
          <div key={index} className="flex justify-between items-center">
            <div>
              <div className="text-sm font-medium text-gray-600">{player.position}</div>
              <div className="text-sm text-gray-900">{player.playerName || 'No player selected'}</div>
            </div>
            <div className="text-sm font-medium text-gray-900">
              {player.score}
            </div>
          </div>
        ))}

        {/* Summary section */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <span className="font-medium text-gray-700">Total Score</span>
            <span className="font-bold text-gray-900">
              {playerScores.reduce((sum, player) => sum + player.score, 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamCard;
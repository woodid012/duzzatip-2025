'use client'

import { useState, useEffect } from 'react';

export default function PlayerStats() {
  const [round, setRound] = useState(1);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/all-stats?round=${round}`);
        const data = await res.json();
        const sortedPlayers = data.sort((a, b) => a.player_name.localeCompare(b.player_name));
        setPlayers(sortedPlayers);
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [round]);

  if (loading) return <div className="p-4">Loading stats...</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Player Stats 2024</h1>
        <div>
          <label htmlFor="round-select" className="mr-2">Round:</label>
          <select 
            id="round-select"
            value={round}
            onChange={(e) => setRound(Number(e.target.value))}
            className="p-2 border rounded"
          >
            {[...Array(29)].map((_, i) => (
              <option key={i} value={i}>Round {i}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white shadow-md rounded">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2">Player</th>
              <th className="px-4 py-2">Team</th>
              <th className="px-4 py-2">Opponent</th>
              <th className="px-4 py-2">Kicks</th>
              <th className="px-4 py-2">Handballs</th>
              <th className="px-4 py-2">Marks</th>
              <th className="px-4 py-2">Tackles</th>
              <th className="px-4 py-2">Hitouts</th>
              <th className="px-4 py-2">Goals</th>
              <th className="px-4 py-2">Behinds</th>
              <th className="px-4 py-2">CBAs</th>
              <th className="px-4 py-2">Kick Ins</th>
              <th className="px-4 py-2">Kick Ins (Play On)</th>
              <th className="px-4 py-2">TOG%</th>
              <th className="px-4 py-2">Fantasy</th>
              <th className="px-4 py-2">SuperCoach</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player, index) => (
              <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : ''}>
                <td className="px-4 py-2">{player.player_name}</td>
                <td className="px-4 py-2">{player.team_name}</td>
                <td className="px-4 py-2">{player.opp}</td>
                <td className="px-4 py-2">{player.kicks}</td>
                <td className="px-4 py-2">{player.handballs}</td>
                <td className="px-4 py-2">{player.marks}</td>
                <td className="px-4 py-2">{player.tackles}</td>
                <td className="px-4 py-2">{player.hitouts}</td>
                <td className="px-4 py-2">{player.goals}</td>
                <td className="px-4 py-2">{player.behinds}</td>
                <td className="px-4 py-2">{player.centreBounceAttendances}</td>
                <td className="px-4 py-2">{player.kickIns}</td>
                <td className="px-4 py-2">{player.kickInsPlayon}</td>
                <td className="px-4 py-2">{player.timeOnGroundPercentage}%</td>
                <td className="px-4 py-2">{player.dreamTeamPoints}</td>
                <td className="px-4 py-2">{player.SC}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
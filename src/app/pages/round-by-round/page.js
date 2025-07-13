'use client';

import React, { useState, useEffect } from 'react';
import { USER_NAMES } from '@/app/lib/constants';

export default function RoundByRoundPage() {
  const [roundData, setRoundData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAllRoundData = async () => {
      try {
        const allData = {};
        for (let round = 1; round <= 21; round++) {
          const res = await fetch(`/api/final-totals?round=${round}`);
          if (!res.ok) {
            console.warn(`Could not fetch data for round ${round}`);
            continue;
          }
          const data = await res.json();
          if (data.finalTotals) {
            for (const userId in data.finalTotals) {
              if (!allData[userId]) {
                allData[userId] = { rounds: {}, seasonTotal: 0 };
              }
              allData[userId].rounds[round] = data.finalTotals[userId];
            }
          }
        }

        // Calculate season totals
        for (const userId in allData) {
          allData[userId].seasonTotal = Object.values(allData[userId].rounds).reduce((acc, roundScores) => acc + roundScores.total, 0);
        }

        setRoundData(allData);
        console.log("Round-by-Round data fetched:", allData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAllRoundData();
  }, []);

  if (loading) {
    return <div className="p-4">Loading...</div>;
  }

  if (error) {
    return <div className="p-4">Error: {error}</div>;
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Round-by-Round Scores</h1>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th rowSpan="2" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Player</th>
              {[...Array(21)].map((_, i) => (
                <th key={i + 1} colSpan="3" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Round {i + 1}</th>
              ))}
              <th rowSpan="2" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
            </tr>
            <tr>
              {[...Array(21)].map((_, i) => (
                <React.Fragment key={i}>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Certs</th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {Object.keys(USER_NAMES).map(userId => (
              <tr key={userId}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{USER_NAMES[userId]}</td>
                {[...Array(21)].map((_, i) => {
                  const round = i + 1;
                  const roundScores = roundData[userId]?.rounds[round] || { teamScore: 0, deadCertScore: 0, total: 0 };
                  return (
                    <React.Fragment key={round}>
                      <td className="px-2 py-4 whitespace-nowrap text-sm text-gray-500 text-center">{roundScores.teamScore}</td>
                      <td className="px-2 py-4 whitespace-nowrap text-sm text-gray-500 text-center">{roundScores.deadCertScore}</td>
                      <td className="px-2 py-4 whitespace-nowrap text-sm text-gray-800 font-bold text-center">{roundScores.total}</td>
                    </React.Fragment>
                  );
                })}
                <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{roundData[userId]?.seasonTotal || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
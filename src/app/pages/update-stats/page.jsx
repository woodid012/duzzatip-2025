'use client';

import React, { useState } from 'react';
import { useUserContext } from '../layout';

function UpdateStatsPage() {
  const { selectedUserId } = useUserContext();
  const [round, setRound] = useState(6); // Default to Round 6
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle', 'loading', 'success', 'error'
  const [result, setResult] = useState(null);

  const handleUpdateStats = async () => {
    if (!round) {
      setMessage('Please select a round');
      setStatus('error');
      return;
    }

    try {
      setLoading(true);
      setStatus('loading');
      setMessage(`Fetching and updating stats for Round ${round}...`);

      const response = await fetch(`/api/update-round-stats?round=${round}`);
      const data = await response.json();

      if (response.ok) {
        setStatus('success');
        setMessage(`Success! Updated stats for Round ${round}`);
        setResult(data.stats);
      } else {
        setStatus('error');
        setMessage(`Error: ${data.error || 'Failed to update stats'}`);
        setResult(data.details || null);
      }
    } catch (error) {
      setStatus('error');
      setMessage(`Error: ${error.message || 'Something went wrong'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Update AFL Stats</h1>
      
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Select Round:</label>
          <div className="flex gap-2">
            <select
              value={round}
              onChange={(e) => setRound(Number(e.target.value))}
              className="p-2 border rounded w-32"
              disabled={loading}
            >
              {[...Array(23)].map((_, i) => (
                <option key={i+1} value={i+1}>
                  Round {i+1}
                </option>
              ))}
            </select>
            
            <button
              onClick={handleUpdateStats}
              disabled={loading}
              className={`px-4 py-2 rounded ${
                loading 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {loading ? 'Updating...' : 'Update Stats'}
            </button>
          </div>
        </div>
        
        {message && (
          <div className={`p-4 rounded mt-4 ${
            status === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
            status === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
            status === 'loading' ? 'bg-blue-50 text-blue-800 border border-blue-200' :
            'bg-gray-50 text-gray-800 border border-gray-200'
          }`}>
            <p className="font-medium">{message}</p>
            
            {result && (
              <div className="mt-3 text-sm">
                <h3 className="font-semibold mb-1">Update Details:</h3>
                <ul className="list-disc pl-5">
                  <li>Round: {result.roundProcessed}</li>
                  <li>Records processed: {result.recordsProcessed}</li>
                  <li>Records inserted: {result.recordsInserted}</li>
                </ul>
              </div>
            )}
          </div>
        )}
        
        <div className="mt-6 text-sm text-gray-600">
          <p className="mb-2">
            This tool fetches the latest AFL player stats from DFS Australia and updates your database.
          </p>
          <p>
            Note: This will replace all existing data for the selected round.
          </p>
        </div>
      </div>
    </div>
  );
}

export default UpdateStatsPage;
'use client';

import React, { useState } from 'react';

function UpdatePlayersPage() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);

  const handleUpdate = async () => {
    try {
      setLoading(true);
      setStatus('loading');
      setMessage('Fetching player rosters from AFL API...');
      setResult(null);

      const res = await fetch('/api/update-players');
      const data = await res.json();

      if (res.ok && data.ok) {
        setStatus('success');
        setMessage(`Updated ${data.players} players across ${data.teams} teams`);
        setResult(data);
      } else {
        setStatus('error');
        setMessage(`Error: ${data.error || 'Failed to update players'}`);
      }
    } catch (error) {
      setStatus('error');
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Update Player List</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <button
            onClick={handleUpdate}
            disabled={loading}
            className={`px-4 py-2 rounded ${
              loading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {loading ? 'Updating...' : 'Refresh Player List from AFL'}
          </button>
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
              <div className="mt-3 text-sm space-y-3">
                <div>
                  <h3 className="font-semibold mb-1">Summary:</h3>
                  <ul className="list-disc pl-5">
                    <li>Teams fetched: {result.teams}</li>
                    <li>Players inserted: {result.inserted}</li>
                  </ul>
                </div>

                {result.teamUpdatesInSquads?.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-1">Squad Team Updates:</h3>
                    <ul className="list-disc pl-5">
                      {result.teamUpdatesInSquads.map((u, i) => (
                        <li key={i}>
                          {u.player}: {u.from} → {u.to}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-sm text-gray-600">
          <p className="mb-2">
            Fetches all current AFL player rosters from the official AFL API and updates the player database.
          </p>
          <p>
            Also syncs team names for players in DuzzaTip squads (e.g. if a player changed clubs).
          </p>
        </div>
      </div>
    </div>
  );
}

export default UpdatePlayersPage;

'use client';

import React, { useState, useEffect } from 'react';
import { useUserContext } from '../layout';
import { useAppContext } from '@/app/context/AppContext';

function UpdateStatsPage() {
  const { selectedUserId } = useUserContext();
  const { currentRound } = useAppContext();
  const [round, setRound] = useState(currentRound);
  const [source, setSource] = useState(''); // '' = auto, 'afl', 'dfs'
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle', 'loading', 'success', 'error'
  const [result, setResult] = useState(null);

  // Update round state if currentRound from context changes
  useEffect(() => {
    if (currentRound !== null) {
      setRound(currentRound);
    }
  }, [currentRound]);

  // Auto-refresh stats on page visit (10-min cooldown via ifStale)
  const [autoRefreshDone, setAutoRefreshDone] = useState(false);
  useEffect(() => {
    if (currentRound == null || autoRefreshDone) return;
    setAutoRefreshDone(true);

    (async () => {
      try {
        setStatus('loading');
        setMessage(`Checking for fresh Round ${currentRound} stats...`);
        const res = await fetch(`/api/update-round-stats?round=${currentRound}&ifStale=1`);
        const data = await res.json();

        if (data.skipped) {
          setStatus('success');
          setMessage(`Round ${currentRound} stats already fresh (updated ${data.ageMinutes}m ago)`);
        } else if (res.ok) {
          setStatus('success');
          setMessage(`Round ${currentRound} auto-refreshed from ${(data.source || '?').toUpperCase()}`);
          setResult(data.stats || null);
        } else {
          setStatus('error');
          setMessage(`Auto-refresh failed: ${data.error || 'Unknown error'}`);
        }
      } catch {
        // Silent fail for auto-refresh — user can still click the button
        setStatus('idle');
        setMessage('');
      }
    })();
  }, [currentRound, autoRefreshDone]);

  const handleUpdateStats = async () => {
    if (round == null) {
      setMessage('Please select a round');
      setStatus('error');
      return;
    }

    try {
      setLoading(true);
      setStatus('loading');
      const sourceLabel = source ? source.toUpperCase() : 'AFL API (with DFS fallback)';
      setMessage(`Fetching stats for Round ${round} from ${sourceLabel}...`);

      const params = new URLSearchParams({ round });
      if (source) params.set('source', source);
      const response = await fetch(`/api/update-round-stats?${params}`);
      const data = await response.json();

      if (response.ok) {
        setStatus('success');
        setMessage(`Round ${round} updated from ${(data.source || '?').toUpperCase()}`);
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
              {[...Array(25)].map((_, i) => (
                <option key={i} value={i}>
                  Round {i}
                </option>
              ))}
            </select>
            
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="p-2 border rounded w-40"
              disabled={loading}
            >
              <option value="">Auto (AFL → DFS)</option>
              <option value="afl">AFL API only</option>
              <option value="dfs">DFS Australia only</option>
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
            Fetches player stats and saves them to the database. <strong>Auto</strong> tries the AFL API first (live stats), then falls back to DFS Australia.
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
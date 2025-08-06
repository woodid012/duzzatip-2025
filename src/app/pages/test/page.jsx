// src/app/pages/ladder-diagnostic/page.jsx

'use client';

import { useState } from 'react';
import { USER_NAMES } from '@/app/lib/constants';

export default function LadderDiagnosticPage() {
  const [round, setRound] = useState(1);
  const [consolidatedData, setConsolidatedData] = useState(null);
  const [storedData, setStoredData] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);

  const diagnoseRound = async () => {
    try {
      setLoading(true);
      
      // Get data from consolidated-round-results (original source)
      const consolidatedResponse = await fetch(`/api/consolidated-round-results?round=${round}`);
      const consolidated = await consolidatedResponse.json();
      setConsolidatedData(consolidated);
      
      // Get data from final-totals (stored in DB)
      const storedResponse = await fetch(`/api/final-totals?round=${round}`);
      const stored = await storedResponse.json();
      setStoredData(stored);
      
      // Compare the two
      const comp = {};
      Object.keys(USER_NAMES).forEach(userId => {
        const consolidatedTotal = consolidated.results?.[userId]?.totalScore || 0;
        const storedTotal = stored.finalTotals?.[userId] || 0;
        
        comp[userId] = {
          userName: USER_NAMES[userId],
          consolidated: consolidatedTotal,
          stored: storedTotal,
          match: consolidatedTotal === storedTotal,
          difference: consolidatedTotal - storedTotal
        };
      });
      setComparison(comp);
      
    } catch (error) {
      console.error('Diagnostic error:', error);
      alert('Error running diagnostic. Check console.');
    } finally {
      setLoading(false);
    }
  };

  const fixRound = async () => {
    try {
      setLoading(true);
      
      // Get the correct data from consolidated-round-results
      const consolidatedResponse = await fetch(`/api/consolidated-round-results?round=${round}`);
      const consolidated = await consolidatedResponse.json();
      
      // Format it correctly for storage
      const allFinalTotals = {};
      Object.entries(consolidated.results || {}).forEach(([userId, result]) => {
        allFinalTotals[userId] = {
          teamScore: result.playerScore || 0,
          deadCertScore: result.deadCertScore || 0,
          total: result.totalScore || 0
        };
      });
      
      // Store it
      await fetch('/api/final-totals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round,
          allFinalTotals
        })
      });
      
      // Force recalculate ladder
      await fetch('/api/ladder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round,
          forceRecalculate: true
        })
      });
      
      alert(`Fixed round ${round}. Re-run diagnostic to verify.`);
      await diagnoseRound();
      
    } catch (error) {
      console.error('Fix error:', error);
      alert('Error fixing round. Check console.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Ladder Diagnostic Tool</h1>
      
      <div className="mb-4 flex gap-4 items-center">
        <label>Round:</label>
        <input 
          type="number" 
          min="1" 
          max="21" 
          value={round}
          onChange={(e) => setRound(parseInt(e.target.value))}
          className="border px-2 py-1 rounded"
        />
        <button 
          onClick={diagnoseRound}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          Diagnose Round
        </button>
        <button 
          onClick={fixRound}
          disabled={loading}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
        >
          Fix This Round
        </button>
      </div>
      
      {comparison && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-4">Round {round} Comparison</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-2 text-left">User</th>
                <th className="border p-2 text-center">Consolidated API</th>
                <th className="border p-2 text-center">Stored in DB</th>
                <th className="border p-2 text-center">Match?</th>
                <th className="border p-2 text-center">Difference</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(comparison).map(([userId, data]) => (
                <tr key={userId} className={data.match ? '' : 'bg-red-50'}>
                  <td className="border p-2">{data.userName}</td>
                  <td className="border p-2 text-center">{data.consolidated}</td>
                  <td className="border p-2 text-center">{data.stored}</td>
                  <td className="border p-2 text-center">
                    {data.match ? '✅' : '❌'}
                  </td>
                  <td className="border p-2 text-center">
                    {data.difference !== 0 && data.difference}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="mt-4 p-4 bg-gray-100 rounded">
            <h3 className="font-semibold mb-2">Raw Data</h3>
            <details>
              <summary>Consolidated Results</summary>
              <pre className="text-xs overflow-auto">{JSON.stringify(consolidatedData, null, 2)}</pre>
            </details>
            <details className="mt-2">
              <summary>Stored Final Totals</summary>
              <pre className="text-xs overflow-auto">{JSON.stringify(storedData, null, 2)}</pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
'use client'

import { useState } from 'react';
import { RefreshCw, Database, Play, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

export default function LadderAdminPage() {
  const [isInitializing, setIsInitializing] = useState(false);
  const [initResults, setInitResults] = useState(null);
  const [currentRound, setCurrentRound] = useState(null);
  const [logs, setLogs] = useState([]);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
  };

  const initializeLadderDatabase = async () => {
    setIsInitializing(true);
    setInitResults(null);
    setLogs([]);
    
    const rounds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    
    addLog('🚀 Starting ladder database initialization...', 'info');
    addLog(`Will process rounds: ${rounds.join(', ')}`, 'info');
    
    const results = {
      success: [],
      failed: [],
      skipped: []
    };
    
    for (const round of rounds) {
      try {
        setCurrentRound(round);
        addLog(`📊 Processing Round ${round}...`, 'info');
        
        // Call the API to calculate and store results for this round
        const response = await fetch('/api/store-round-results', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            round: round,
            forceRecalculate: true // Force recalculation even if data exists
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.success) {
            addLog(`✅ Round ${round}: ${data.message}`, 'success');
            addLog(`   Users processed: ${data.userCount}`, 'info');
            
            const sampleScores = Object.entries(data.results)
              .slice(0, 3)
              .map(([userId, score]) => `User${userId}:${score}`)
              .join(', ');
            addLog(`   Sample scores: ${sampleScores}`, 'info');
            
            results.success.push({
              round,
              userCount: data.userCount,
              totalScore: Object.values(data.results).reduce((sum, score) => sum + score, 0)
            });
          } else {
            addLog(`⚠️ Round ${round}: ${data.message}`, 'warning');
            results.skipped.push({ round, reason: data.message });
          }
        } else {
          const errorData = await response.json();
          addLog(`❌ Round ${round} failed: ${errorData.error}`, 'error');
          results.failed.push({ round, error: errorData.error });
        }
        
        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        addLog(`💥 Round ${round} exception: ${error.message}`, 'error');
        results.failed.push({ round, error: error.message });
      }
    }
    
    // Summary
    setCurrentRound(null);
    addLog('🏁 Initialization Complete!', 'success');
    addLog(`✅ Successfully processed: ${results.success.length} rounds`, 'success');
    addLog(`⚠️ Skipped: ${results.skipped.length} rounds`, 'warning');
    addLog(`❌ Failed: ${results.failed.length} rounds`, 'error');
    
    if (results.success.length > 0) {
      addLog('📈 Successfully processed rounds:', 'info');
      results.success.forEach(({ round, userCount, totalScore }) => {
        addLog(`   Round ${round}: ${userCount} users, total points: ${totalScore}`, 'info');
      });
    }
    
    // Now trigger ladder recalculation for the final round
    if (results.success.length > 0) {
      const finalRound = Math.max(...results.success.map(r => r.round));
      addLog(`🏆 Calculating final ladder through round ${finalRound}...`, 'info');
      
      try {
        const ladderResponse = await fetch('/api/ladder', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            round: finalRound,
            standings: [],
            forceRecalculate: true
          })
        });
        
        if (ladderResponse.ok) {
          const ladderData = await ladderResponse.json();
          addLog('✅ Ladder calculated successfully!', 'success');
          
          if (ladderData.standings) {
            addLog('🏆 Current Ladder Positions:', 'info');
            ladderData.standings.slice(0, 8).forEach((team, index) => {
              addLog(`   ${index + 1}. ${team.userName} - ${team.points} pts (${team.wins}W-${team.losses}L-${team.draws}D)`, 'info');
            });
          }
        } else {
          addLog('❌ Failed to calculate ladder', 'error');
        }
      } catch (ladderError) {
        addLog(`💥 Ladder calculation failed: ${ladderError.message}`, 'error');
      }
    }
    
    setInitResults(results);
    setIsInitializing(false);
  };

  const clearLogs = () => {
    setLogs([]);
    setInitResults(null);
  };

  const getLogIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning': return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default: return <Database className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLogColor = (type) => {
    switch (type) {
      case 'success': return 'text-green-700';
      case 'error': return 'text-red-700';
      case 'warning': return 'text-yellow-700';
      default: return 'text-gray-700';
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Ladder Database Admin</h1>
        <p className="text-gray-600">
          Initialize the ladder database with calculated results for rounds 1-11. 
          This will store results in MongoDB and generate the ladder standings.
        </p>
      </div>

      {/* Control Panel */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Database Initialization</h2>
        
        <div className="flex gap-4 mb-4">
          <button
            onClick={initializeLadderDatabase}
            disabled={isInitializing}
            className={`flex items-center gap-2 px-4 py-2 rounded ${
              isInitializing
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {isInitializing ? (
              <RefreshCw className="h-5 w-5 animate-spin" />
            ) : (
              <Play className="h-5 w-5" />
            )}
            {isInitializing ? 'Initializing...' : 'Initialize Rounds 1-11'}
          </button>
          
          <button
            onClick={clearLogs}
            disabled={isInitializing}
            className="flex items-center gap-2 px-4 py-2 rounded bg-gray-500 text-white hover:bg-gray-600 disabled:opacity-50"
          >
            Clear Logs
          </button>
        </div>

        {/* Current Status */}
        {isInitializing && currentRound && (
          <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
              <span className="font-medium text-blue-800">
                Currently processing Round {currentRound}...
              </span>
            </div>
          </div>
        )}

        {/* Results Summary */}
        {initResults && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-green-50 border border-green-200 rounded p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="font-medium text-green-800">Success</span>
              </div>
              <div className="text-2xl font-bold text-green-900">
                {initResults.success.length}
              </div>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-500" />
                <span className="font-medium text-yellow-800">Skipped</span>
              </div>
              <div className="text-2xl font-bold text-yellow-900">
                {initResults.skipped.length}
              </div>
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded p-4">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <span className="font-medium text-red-800">Failed</span>
              </div>
              <div className="text-2xl font-bold text-red-900">
                {initResults.failed.length}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Logs Panel */}
      {logs.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Process Log</h2>
          
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
            {logs.map((log, index) => (
              <div key={index} className="flex items-start gap-2 mb-1">
                <span className="text-gray-500 text-xs mt-1">
                  {log.timestamp}
                </span>
                <div className="flex items-start gap-1">
                  {getLogIcon(log.type)}
                  <span className={getLogColor(log.type)}>
                    {log.message}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-800 mb-2">What this does:</h3>
        <ul className="text-blue-700 text-sm space-y-1">
          <li>• Calculates round results for rounds 1-11 using your existing scoring system</li>
          <li>• Stores results in MongoDB collection: <code>2025_round_results</code></li>
          <li>• Generates and stores ladder standings in: <code>2025_ladder</code></li>
          <li>• Includes all scoring rules: substitutions, bench players, dead cert bonuses</li>
          <li>• Only needs to be run ONCE to initialize the database</li>
        </ul>
      </div>
    </div>
  );
}
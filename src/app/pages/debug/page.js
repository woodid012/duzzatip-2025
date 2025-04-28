'use client';

import { useState, useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import useResults from '@/app/hooks/useResults'; // This will use your modified debug version
import { USER_NAMES } from '@/app/lib/constants';

export default function DebugPage() {
  const { currentRound } = useAppContext();
  const [displayRound, setDisplayRound] = useState(6); // Default to Round 6
  
  // Get results functionality from our hook
  const {
    teams,
    loading,
    error,
    roundEndPassed,
    getTeamScores,
    changeRound,
    getDebugInfo
  } = useResults();

  // Set to round 6 explicitly on first render
  useEffect(() => {
    changeRound(6);
  }, [changeRound]);

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    setDisplayRound(newRound);
    changeRound(newRound);
  };

  if (loading) return <div className="p-8 text-center">Loading data...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  
  // Get debug info
  const debugInfo = getDebugInfo();
  
  // Get team scores
  const teamScores = Object.entries(USER_NAMES).map(([userId, userName]) => {
    return {
      userId,
      userName,
      ...getTeamScores(userId)
    };
  });

  return (
    <div className="p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-black">Reserve Substitution Debug</h1>
          
          <div className="flex flex-col gap-1 mt-1">
            <div className="text-sm">
              <span className="font-medium">Round:</span> {displayRound}
            </div>
            <div className="text-sm">
              <span className="font-medium">Round End Passed:</span> 
              <span className={roundEndPassed ? "text-green-600 ml-1" : "text-red-600 ml-1"}>
                {roundEndPassed ? "Yes" : "No"}
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">Reason:</span>
              <span className="ml-1">{debugInfo.roundEndPassedReason}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Debug Info Panel */}
      <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h2 className="text-lg font-bold mb-2">Debug Information</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-semibold mb-1">Round Info</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li><span className="font-medium">Local Round:</span> {debugInfo.currentRound}</li>
              <li><span className="font-medium">Global Round:</span> {debugInfo.globalRound}</li>
              <li><span className="font-medium">Round End Passed:</span> {debugInfo.roundEndPassed ? "Yes" : "No"}</li>
              <li><span className="font-medium">Force Round End:</span> {debugInfo.forceRoundEndPassed ? "Yes" : "No"}</li>
              <li><span className="font-medium">Processing Round:</span> {debugInfo.processingRound}</li>
              <li><span className="font-medium">End Passed Reason:</span> {debugInfo.roundEndPassedReason}</li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold mb-1">Substitution Info</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li><span className="font-medium">Attempted Substitution:</span> {debugInfo.didAttemptSubstitution ? "Yes" : "No"}</li>
            </ul>
          </div>
        </div>
      </div>
      
      {/* Team Scores Table */}
      <div className="mb-6">
        <h2 className="text-lg font-bold mb-2">Team Scores</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-4 border text-black">User</th>
                <th className="py-2 px-4 border text-black">Full Forward</th>
                <th className="py-2 px-4 border text-black">FF Status</th>
                <th className="py-2 px-4 border text-black">Reserve A</th>
                <th className="py-2 px-4 border text-black">RA Status</th>
                <th className="py-2 px-4 border text-black">FF Substituted?</th>
                <th className="py-2 px-4 border text-black">Total Score</th>
              </tr>
            </thead>
            <tbody>
              {teamScores.map(team => {
                const ffPosition = team.positionScores?.find(p => p.position === 'Full Forward');
                const reserveA = team.benchScores?.find(b => b.position === 'Reserve A');
                const ffSubstituted = ffPosition?.isBenchPlayer || false;
                const ffWasSubstitutedByReserveA = ffSubstituted && 
                  (ffPosition?.replacementType === 'Reserve A' || ffPosition?.playerName === reserveA?.playerName);
                
                return (
                  <tr key={team.userId} className="hover:bg-gray-50">
                    <td className="py-2 px-4 border text-black font-medium">{team.userName}</td>
                    <td className="py-2 px-4 border text-black">
                      {ffPosition?.playerName || "None"}
                      {ffPosition?.isBenchPlayer && (
                        <span className="text-xs text-green-600 ml-1">
                          (original: {ffPosition?.originalPlayerName})
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 border">
                      {ffPosition ? (
                        <span className={ffPosition.hasPlayed ? "text-green-600" : "text-red-600"}>
                          {ffPosition.hasPlayed ? "Played" : "Did Not Play"}
                        </span>
                      ) : "N/A"}
                    </td>
                    <td className="py-2 px-4 border text-black">
                      {reserveA ? reserveA.playerName : "None"}
                    </td>
                    <td className="py-2 px-4 border">
                      {reserveA ? (
                        <span className={reserveA.didPlay ? "text-green-600" : "text-red-600"}>
                          {reserveA.didPlay ? "Played" : "Did Not Play"}
                        </span>
                      ) : "N/A"}
                    </td>
                    <td className="py-2 px-4 border">
                      {ffSubstituted ? (
                        <span className="text-green-600 font-medium">
                          Yes - {ffPosition.replacementType}
                          {ffWasSubstitutedByReserveA && " (Reserve A)"}
                        </span>
                      ) : (
                        <span className="text-red-600">No</span>
                      )}
                    </td>
                    <td className="py-2 px-4 border text-black font-bold">
                      {team.finalScore}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Per-User Details */}
      {teamScores.map(team => {
        const ffPosition = team.positionScores?.find(p => p.position === 'Full Forward');
        const reserveA = team.benchScores?.find(b => b.position === 'Reserve A');
        
        return (
          <div key={team.userId} className="mb-4 p-4 border rounded-lg">
            <h3 className="font-bold text-lg mb-2">{team.userName}</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold">Full Forward</h4>
                <div className="pl-4 text-sm">
                  <p><span className="font-medium">Player:</span> {ffPosition?.playerName || "None"}</p>
                  <p><span className="font-medium">Played:</span> {ffPosition?.hasPlayed ? "Yes" : "No"}</p>
                  <p><span className="font-medium">Score:</span> {ffPosition?.score || 0}</p>
                  <p><span className="font-medium">Substituted:</span> {ffPosition?.isBenchPlayer ? "Yes" : "No"}</p>
                  {ffPosition?.isBenchPlayer && (
                    <p><span className="font-medium">Replacement:</span> {ffPosition?.replacementType}</p>
                  )}
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold">Reserve A</h4>
                <div className="pl-4 text-sm">
                  <p><span className="font-medium">Player:</span> {reserveA?.playerName || "None"}</p>
                  <p><span className="font-medium">Played:</span> {reserveA?.didPlay ? "Yes" : "No"}</p>
                  <p><span className="font-medium">Used:</span> {reserveA?.isBeingUsed ? "Yes" : "No"}</p>
                  {reserveA?.isBeingUsed && (
                    <p><span className="font-medium">Replacing:</span> {reserveA?.replacingPosition} ({reserveA?.replacingPlayerName})</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
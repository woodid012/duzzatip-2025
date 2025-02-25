'use client'

import { useState } from 'react';
import { Star } from 'lucide-react';
import { GiCrab } from 'react-icons/gi';
import { useAppContext } from '@/app/context/AppContext';
import useResults from '@/app/hooks/useResults';
import { USER_NAMES } from '@/app/lib/constants';

export default function ResultsPage() {
  // Get data from our app context
  const { currentRound, changeRound } = useAppContext();
  
  // Get results functionality from our hook
  const {
    teams,
    loading,
    error,
    calculateAllTeamScores,
    getTeamScores
  } = useResults();

  // State for toggling visibility on mobile
  const [expandedTeams, setExpandedTeams] = useState({});

  // Toggle team expansion
  const toggleTeamExpansion = (userId) => {
    setExpandedTeams(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }));
  };

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    changeRound(newRound);
  };

  if (loading) return <div className="p-4">Loading stats...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  // Calculate all team scores for determining highest and lowest
  const allTeamScores = calculateAllTeamScores();
  const highestScore = Math.max(...allTeamScores.map(s => s.totalScore), 0);
  const lowestScore = Math.min(...allTeamScores.map(s => s.totalScore), 0);

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-black">Team Scores</h1>
          <div className="w-full sm:w-auto flex items-center gap-2">
            <label htmlFor="round-select" className="text-sm font-medium text-black">Round:</label>
            <select 
              id="round-select"
              value={currentRound}
              onChange={handleRoundChange}
              className="p-2 border rounded w-24 text-lg text-black"
            >
              {[...Array(29)].map((_, i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Object.entries(USER_NAMES).map(([userId, userName]) => {
          // Get scores for this user's team
          const teamScores = getTeamScores(userId);
          const isExpanded = expandedTeams[userId] !== false; // Default to expanded
          
          return (
            <div key={userId} className="bg-white rounded-lg shadow-md p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-bold text-black">{userName}</h2>
                  {teamScores.finalScore === highestScore && highestScore > 0 && 
                    <Star className="text-yellow-500" size={20} />}
                  {teamScores.finalScore === lowestScore && lowestScore > 0 && 
                    <GiCrab className="text-red-500" size={20} />}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right font-bold text-lg border-t pt-2 text-black">
                    Final Total: {teamScores.finalScore}
                  </div>
                  <button 
                    onClick={() => toggleTeamExpansion(userId)}
                    className="text-gray-500 hover:text-black sm:hidden"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isExpanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                    </svg>
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="space-y-4">
                  {/* Main Team */}
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold border-b pb-2 text-black">Main Team</h3>
                    <div className="hidden sm:grid grid-cols-12 gap-2 font-semibold text-sm pb-2 text-black">
                      <div className="col-span-2">Position</div>
                      <div className="col-span-3">Player</div>
                      <div className="col-span-5">Details</div>
                      <div className="col-span-2 text-right">Score</div>
                    </div>
                    {teamScores.positionScores.map((position) => (
                      <div key={position.position} className="border rounded p-2 sm:border-0 sm:p-0 sm:grid grid-cols-12 gap-2 text-sm text-black">
                        <div className="font-medium col-span-2 mb-1 sm:mb-0">{position.position}</div>
                        <div className="col-span-3 mb-1 sm:mb-0">
                          {position.isBenchPlayer ? (
                            <span className="text-green-600">Bench: {position.playerName}</span>
                          ) : (
                            position.playerName || 'Not Selected'
                          )}
                        </div>
                        <div className="col-span-5 text-black text-xs sm:text-sm mb-1 sm:mb-0">
                          {position.breakdown}
                        </div>
                        <div className="col-span-2 text-right font-semibold">
                          {position.score}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Team Subtotal */}
                  <div className="text-right font-semibold mt-2 text-black">
                    Team Score: {teamScores.totalScore}
                  </div>

                  {/* Dead Certs */}
                  <div className="space-y-2">
                    <div className="text-right font-semibold text-black">
                      Dead Cert Bonus: {teamScores.deadCertScore}
                    </div>
                  </div>

                  {/* Bench/Reserves */}
                  <div className="space-y-2 bg-gray-50 p-2 sm:p-4 rounded">
                    <h3 className="text-lg font-semibold border-b pb-2 text-black">Bench/Reserves</h3>
                    {teamScores.benchScores.map((bench) => (
                      <div key={bench.position} className="border rounded p-2 sm:border-0 sm:p-0 sm:grid grid-cols-12 gap-2 text-sm text-black">
                        <div className="font-medium col-span-2 mb-1 sm:mb-0">
                          {bench.position}
                          {bench.backupPosition && (
                            <div className="text-xs text-black">{bench.backupPosition}</div>
                          )}
                        </div>
                        <div className="col-span-3 mb-1 sm:mb-0">
                          {bench.isBeingUsed ? (
                            <span className="text-red-600">{bench.replacingPlayerName}</span>
                          ) : (
                            bench.playerName
                          )}
                        </div>
                        <div className="col-span-5 text-black text-xs sm:text-sm mb-1 sm:mb-0">
                          {bench.breakdown}
                        </div>
                        <div className="col-span-2 text-right font-semibold">
                          {bench.score}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
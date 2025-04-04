'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { USER_NAMES } from '@/app/lib/constants';
import useLadder from '@/app/hooks/useLadder';
import { getFixturesForRound } from '@/app/lib/fixture_constants';
import { Star } from 'lucide-react';
import { GiCrab } from 'react-icons/gi';

export default function LadderPage() {
  const { 
    ladder, 
    loading, 
    error, 
    changeRound, 
    isFinalRound, 
    getFinalRoundName,
    currentRound,
    allTeamScores
  } = useLadder();
  
  // Find best and worst scores for current round
  const [highestScore, setHighestScore] = useState(0);
  const [lowestScore, setLowestScore] = useState(0);
  const [roundScores, setRoundScores] = useState({});
  const [mostStars, setMostStars] = useState([]);
  const [mostCrabs, setMostCrabs] = useState([]);
  
  // Add ref to prevent infinite loops
  const processedScores = useRef(false);

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    changeRound(newRound);
  };
  
  // Process round scores to find highest and lowest for current round
  // FIXED: Added proper dependency array and condition to prevent infinite updates
  useEffect(() => {
    // Skip if we've already processed these scores or if allTeamScores isn't available yet
    if (processedScores.current || !allTeamScores || !allTeamScores[currentRound]) {
      return;
    }
    
    const roundData = allTeamScores[currentRound];
    setRoundScores(roundData);
    
    // Find highest and lowest scores
    if (roundData && Object.keys(roundData).length > 0) {
      // Skip if all scores are 0 (games haven't been played yet)
      const allZeros = Object.values(roundData).every(score => score === 0);
      if (allZeros) {
        setHighestScore(0);
        setLowestScore(0);
      } else {
        const scores = Object.entries(roundData).map(([userId, score]) => ({ userId, score }));
        const highest = Math.max(...scores.map(item => item.score));
        const lowest = Math.min(...scores.map(item => item.score));
        
        // Only set if there are actual scores (greater than 0)
        if (highest > 0) {
          setHighestScore(highest);
          // Only set lowest if it's greater than 0 (actual game played)
          setLowestScore(lowest > 0 ? lowest : 0);
        }
      }
    }
    
    // Mark as processed to prevent re-processing
    processedScores.current = true;
  }, [currentRound, allTeamScores]);
  
  // Reset the processedScores ref when round changes
  useEffect(() => {
    processedScores.current = false;
  }, [currentRound]);
  
  // Calculate star and crab totals for each team
  const calculateStarCrabTotals = () => {
    const totals = {};
    
    // Initialize totals for all teams
    Object.keys(USER_NAMES).forEach(userId => {
      totals[userId] = { stars: 0, crabs: 0 };
    });
    
    // Go through each round's scores to count stars and crabs
    if (allTeamScores) {
      Object.entries(allTeamScores).forEach(([round, roundScores]) => {
        // Skip round 0 and rounds with no scores or incomplete data
        if (round === '0' || !roundScores || Object.keys(roundScores).length === 0) {
          return;
        }
        
        // Skip rounds where all scores are 0 (games haven't been played yet)
        const allZeros = Object.values(roundScores).every(score => score === 0);
        if (allZeros) {
          return;
        }
        
        const scores = Object.entries(roundScores).map(([userId, score]) => ({ userId, score }));
        
        // Find highest and lowest scores for this round
        const highestScore = Math.max(...scores.map(item => item.score));
        const lowestScore = Math.min(...scores.map(item => item.score));
        
        // Only count if there are actual scores (greater than 0)
        if (highestScore > 0) {
          // Count stars and crabs
          scores.forEach(({ userId, score }) => {
            if (score === highestScore) {
              totals[userId].stars += 1;
            }
            if (score === lowestScore && lowestScore > 0) {
              totals[userId].crabs += 1;
            }
          });
        }
      });
    }
    
    return totals;
  };
  
  // Calculate the totals - wrapped in useMemo to avoid recalculating on every render
  const starCrabTotals = useMemo(() => calculateStarCrabTotals(), [allTeamScores]);
  
  // Find players with the most stars and crabs - FIXED: added proper dependencies
  useEffect(() => {
    if (starCrabTotals && Object.keys(starCrabTotals).length > 0) {
      // Find the highest star and crab counts
      const maxStars = Math.max(...Object.values(starCrabTotals).map(t => t.stars));
      const maxCrabs = Math.max(...Object.values(starCrabTotals).map(t => t.crabs));
      
      // Find all users with the max stars/crabs count
      const usersWithMostStars = Object.entries(starCrabTotals)
        .filter(([_, totals]) => totals.stars === maxStars && maxStars > 0)
        .map(([userId]) => userId);
        
      const usersWithMostCrabs = Object.entries(starCrabTotals)
        .filter(([_, totals]) => totals.crabs === maxCrabs && maxCrabs > 0)
        .map(([userId]) => userId);
      
      setMostStars(usersWithMostStars);
      setMostCrabs(usersWithMostCrabs);
    }
  }, [starCrabTotals]); // Only depends on starCrabTotals

  // Display loading state
  if (loading) {
    return <div className="p-4">Loading ladder...</div>;
  }
  
  // Display error state
  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-black">Season Ladder</h1>
          <div className="w-full sm:w-auto flex items-center gap-2">
            <label htmlFor="round-select" className="text-sm font-medium text-black">Round:</label>
            <select 
              id="round-select"
              value={currentRound}
              onChange={handleRoundChange}
              className="p-2 border rounded w-24 text-base text-black"
            >
              {[...Array(25)].map((_, i) => (
                <option key={i} value={i}>{i === 0 ? 'Opening' : i}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Finals banner for rounds 22-24 */}
      {isFinalRound(currentRound) && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h2 className="text-xl font-semibold text-yellow-800">
            Finals Series: {getFinalRoundName(currentRound)}
          </h2>
          <p className="text-yellow-700">
            {currentRound === 22 && "Top team plays 4th, 2nd plays 3rd. Winners advance to preliminary & grand finals."}
            {currentRound === 23 && "Winner from Qualifying Final 2 plays the loser from Qualifying Final 1."}
            {currentRound === 24 && "Grand Final - Winner takes all!"}
          </p>
        </div>
      )}

      {/* Ladder table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pos</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">P</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">W</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">L</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">D</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PF (Ave)</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">PA (Ave)</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">%</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <Star className="inline text-yellow-500" size={14} />
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <GiCrab className="inline text-red-500" size={14} />
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Pts</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {ladder.map((team, index) => (
              <tr key={team.userId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {index + 1}
                  {index === 0 && <span className="ml-1 text-green-600">•</span>}
                  {index >= 1 && index <= 3 && <span className="ml-1 text-blue-600">•</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  <div className="flex items-center gap-1">
                    {team.userName}
                    
                    {/* Show current round star/crab if applicable */}
                    {roundScores[team.userId] && 
                     roundScores[team.userId] === highestScore && 
                     highestScore > 0 && 
                      <Star className="text-yellow-500" size={16} />}
                    {roundScores[team.userId] && 
                     roundScores[team.userId] === lowestScore && 
                     lowestScore > 0 && 
                      <GiCrab className="text-red-500" size={16} />}
                    
                    {/* Show indicators for most stars/crabs only if not already showing current round indicators */}
                    {!(roundScores[team.userId] && roundScores[team.userId] === highestScore && highestScore > 0) && 
                     mostStars.includes(team.userId) && 
                      <Star className="text-yellow-500" size={16} />}
                    
                    {!(roundScores[team.userId] && roundScores[team.userId] === lowestScore && lowestScore > 0) && 
                     mostCrabs.includes(team.userId) && 
                      <GiCrab className="text-red-500" size={16} />}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.played}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.wins}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.losses}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.draws}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                  {team.pointsFor} {team.played > 0 && <span className="text-gray-400">({Math.round(team.pointsFor / team.played)})</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                  {team.pointsAgainst} {team.played > 0 && <span className="text-gray-400">({Math.round(team.pointsAgainst / team.played)})</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">{team.percentage}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                  <div className="flex items-center justify-center">
                    <span className={`font-medium ${mostStars.includes(team.userId) ? 'text-yellow-600 font-bold' : 'text-yellow-600'}`}>
                      {starCrabTotals[team.userId]?.stars || 0}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                  <div className="flex items-center justify-center">
                    <span className={`font-medium ${mostCrabs.includes(team.userId) ? 'text-red-600 font-bold' : 'text-red-600'}`}>
                      {starCrabTotals[team.userId]?.crabs || 0}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-medium text-gray-900">{team.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 text-sm text-gray-600">
        <div className="flex flex-wrap gap-4">
          <div><span className="inline-block w-2 h-2 rounded-full bg-green-600 mr-1"></span> Top position (automatic Grand Final)</div>
          <div><span className="inline-block w-2 h-2 rounded-full bg-blue-600 mr-1"></span> Finals positions (2-4)</div>
          <div className="flex items-center"><Star className="text-yellow-500 mr-1" size={16} /> Highest score for round / Most star performances overall</div>
          <div className="flex items-center"><GiCrab className="text-red-500 mr-1" size={16} /> Lowest score for round / Most crab performances overall</div>
        </div>
        <div className="mt-2">
          <span className="font-medium">P</span>: Played, 
          <span className="font-medium ml-2">W</span>: Wins, 
          <span className="font-medium ml-2">L</span>: Losses, 
          <span className="font-medium ml-2">D</span>: Draws, 
          <span className="font-medium ml-2">PF (Ave)</span>: Points For (Average per game), 
          <span className="font-medium ml-2">PA (Ave)</span>: Points Against (Average per game), 
          <span className="font-medium ml-2">%</span>: Percentage, 
          <span className="font-medium ml-2">
            <Star className="inline text-yellow-500 mb-1" size={14} />
          </span>: Total highest scores (excluding Round 0),
          <span className="font-medium ml-2">
            <GiCrab className="inline text-red-500 mb-1" size={14} />
          </span>: Total lowest scores (excluding Round 0),
          <span className="font-medium ml-2">Pts</span>: Ladder Points (Win: 4, Draw: 2, Loss: 0)
        </div>
      </div>
    </div>
  );
}
'use client'

import { useState } from 'react';
import { Star } from 'lucide-react';
import { GiCrab } from 'react-icons/gi';

// Helper function to get 3-letter team abbreviation
const getTeamAbbreviation = (teamName) => {
  if (!teamName) return '';
  
  // Common AFL team abbreviations
  const abbreviations = {
    'Adelaide': 'ADE',
    'Brisbane Lions': 'BRL',
    'Brisbane': 'BRL',
    'Carlton': 'CAR',
    'Collingwood': 'COL',
    'Essendon': 'ESS',
    'Fremantle': 'FRE',
    'Geelong': 'GEE',
    'Gold Coast': 'GCS',
    'Greater Western Sydney': 'GWS',
    'GWS Giants': 'GWS',
    'Hawthorn': 'HAW',
    'Melbourne': 'MEL',
    'North Melbourne': 'NTH',
    'Port Adelaide': 'PTA',
    'Richmond': 'RIC',
    'St Kilda': 'STK',
    'Sydney': 'SYD',
    'West Coast': 'WCE',
    'Western Bulldogs': 'WBD',
    'Bulldogs': 'WBD'
  };
  
  // Try to find the exact match first
  if (abbreviations[teamName]) {
    return abbreviations[teamName];
  }
  
  // If no exact match, try to find a partial match
  for (const [team, abbr] of Object.entries(abbreviations)) {
    if (teamName.includes(team)) {
      return abbr;
    }
  }
  
  // If no match found, create abbreviation from first 3 letters
  return teamName.substring(0, 3).toUpperCase();
};

// TeamScoreCard component for displaying a user's team scores
export default function TeamScoreCard({ 
  userId, 
  userName, 
  teamScores, 
  isHighestScore, 
  isLowestScore,
  isSelectedUser,
  isRoundComplete
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="bg-white rounded-lg shadow-md p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg sm:text-xl font-bold text-black">{userName}</h2>
          {isHighestScore && 
            <Star className="text-yellow-500" size={20} />}
          {isLowestScore && 
            <GiCrab className="text-red-500" size={20} />}
          {isSelectedUser && 
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">Selected</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right font-bold text-lg border-t pt-2 text-black">
            Final Total: {teamScores.finalScore}
          </div>
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
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
          <>
            {/* Main Team */}
            <MainTeamSection 
              positionScores={teamScores.positionScores} 
              isRoundComplete={isRoundComplete} 
            />
            
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
            <BenchSection 
              benchScores={teamScores.benchScores} 
              isRoundComplete={isRoundComplete} 
            />
          </>
        </div>
      )}
    </div>
  );
}

// Component for the main team positions
function MainTeamSection({ positionScores, isRoundComplete }) {
  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold border-b pb-2 text-black">Main Team</h3>
      <div className="hidden sm:grid grid-cols-12 gap-2 font-semibold text-sm pb-2 text-black">
        <div className="col-span-2">Position</div>
        <div className="col-span-3">Player</div>
        <div className="col-span-5">Details</div>
        <div className="col-span-2 text-right">Score</div>
      </div>
      {positionScores.map((position) => {
        // Determine player status and styling
        const didNotPlay = position.noStats || !position.player?.hasPlayed;
        const isReplaced = position.isBenchPlayer;
        
        // Only show DNP status if round is complete, otherwise show normal status
        const showDNP = isRoundComplete && didNotPlay;
        
        // Always show original player, but in red if they didn't play or were replaced
        const playerNameClass = (showDNP || isReplaced) ? 'text-red-600' : 'text-black';
        
        // For replaced players, we'll show both original and replacement details
        const originalScore = position.originalScore || 0;
        const replacementScore = isReplaced ? position.score : null;
        
        return (
          <div key={position.position} className="border rounded p-2 sm:border-0 sm:p-0 sm:grid grid-cols-12 gap-2 text-sm text-black">
            <div className="font-medium col-span-2 mb-1 sm:mb-0">{position.position}</div>
            <div className="col-span-3 mb-1 sm:mb-0">
              <div className={playerNameClass}>
                <div className="truncate">{position.originalPlayerName || 'Not Selected'}</div>
                {position.player?.team && (
                  <div className="text-xs text-gray-500">
                    ({getTeamAbbreviation(position.player.team)})
                    {showDNP && ' (DNP)'}
                    {isReplaced && ' (Substituted)'}
                  </div>
                )}
              </div>
            </div>
            <div className="col-span-5 text-xs sm:text-sm mb-1 sm:mb-0">
              {isReplaced ? (
                <div>
                  <div className="text-green-600">
                    Substituted with: {position.playerName} 
                    <span className="ml-1 text-gray-500">({position.replacementType})</span>
                  </div>
                  <div className="text-xs mt-1 text-gray-600">
                    {position.playerName}'s score: {replacementScore}
                  </div>
                </div>
              ) : showDNP ? (
                <div className="text-red-600">
                  Player did not play
                </div>
              ) : (
                position.breakdown
              )}
            </div>
            <div className="col-span-2 text-right">
              <span className={showDNP || isReplaced ? "text-red-600" : "font-semibold"}>
                {originalScore}
              </span>
              
              {isReplaced && (
                <div className="text-xs text-green-600 font-medium mt-1">
                  +{replacementScore} (used)
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Component for the bench/reserves section
function BenchSection({ benchScores, isRoundComplete }) {
  return (
    <div className="space-y-2 bg-gray-50 p-2 sm:p-4 rounded">
      <h3 className="text-lg font-semibold border-b pb-2 text-black">Bench/Reserves</h3>
      {benchScores.map((bench) => {
        // Determine bench player status and styling
        const didNotPlay = !bench.didPlay;
        const isBeingUsed = bench.isBeingUsed;
        
        // Only show DNP status if round is complete
        const showDNP = isRoundComplete && didNotPlay;
        
        // Player and score status colors
        const playerNameClass = isBeingUsed ? 'text-green-600' : showDNP ? 'text-red-600' : 'text-black';
        const scoreClass = showDNP ? 'text-red-600' : isBeingUsed ? 'text-green-600' : 'text-black';
        
        return (
          <div key={bench.position} className="border rounded p-2 sm:border-0 sm:p-0 sm:grid grid-cols-12 gap-2 text-sm text-black">
            <div className="font-medium col-span-2 mb-1 sm:mb-0">
              {bench.position}
              {bench.position === 'Reserve A' && (
                <div className="text-xs text-gray-500">Full Forward, Tall Forward, Ruck</div>
              )}
              {bench.position === 'Reserve B' && (
                <div className="text-xs text-gray-500">Offensive, Mid, Tackler</div>
              )}
              {bench.backupPosition && (
                <div className="text-xs text-gray-500">{bench.backupPosition}</div>
              )}
            </div>
            <div className="col-span-3 mb-1 sm:mb-0">
              <div className={playerNameClass}>
                <div className="truncate">{bench.playerName}</div>
                {bench.player?.team && (
                  <div className="text-xs text-gray-500">
                    ({getTeamAbbreviation(bench.player.team)})
                    {showDNP && ' (DNP)'}
                    {isBeingUsed && ' (In Use)'}
                  </div>
                )}
              </div>
            </div>
            <div className="col-span-5 text-xs sm:text-sm mb-1 sm:mb-0">
              {isBeingUsed ? (
                <div className="text-green-600">
                  Substituting for: {bench.replacingPlayerName} ({bench.replacingPosition})
                </div>
              ) : showDNP ? (
                <div className="text-red-600">
                  Player did not play
                </div>
              ) : (
                bench.breakdown
              )}
            </div>
            <div className={`col-span-2 text-right ${scoreClass} ${isBeingUsed ? "font-semibold" : ""}`}>
              {bench.score}
            </div>
          </div>
        );
      })}
    </div>
  );
}
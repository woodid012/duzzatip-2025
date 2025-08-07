// src/app/pages/results/components/EnhancedRoundSummary.js

'use client'

import { USER_NAMES } from '@/app/lib/constants';

// Component for displaying round summary and fixtures
export default function EnhancedRoundSummary({ 
  displayedRound, 
  roundName, 
  orderedFixtures, 
  allTeamScores, 
  selectedUserId,
  hasSubstitutions,
  isFinals
}) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold mb-4">{roundName}</h2>
      
      {/* Substitution status indicator for regular rounds */}
      {displayedRound >= 1 && !isFinals && (
        <div className={`mb-4 p-2 rounded-lg text-sm ${hasSubstitutions ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-yellow-50 text-yellow-800 border border-yellow-200'}`}>
          <span className="font-semibold">Reserve Players:</span> {hasSubstitutions ? 'Available' : 'Locked'} 
          {!hasSubstitutions && displayedRound >= 1 && (
            <span> - Reserve players will be available after the round ends</span>
          )}
          <div className="mt-1 text-black">
            <span className="font-semibold">Note:</span> Bench players with correct backup positions are always available for substitution
          </div>
        </div>
      )}
      
      {displayedRound === 0 ? (
        <OpeningRoundSummary 
          allTeamScores={allTeamScores} 
          selectedUserId={selectedUserId} 
        />
      ) : isFinals ? (
        <FinalsFixtures 
          fixtures={orderedFixtures} 
          allTeamScores={allTeamScores} 
          selectedUserId={selectedUserId}
          displayedRound={displayedRound} 
        />
      ) : orderedFixtures && orderedFixtures.length > 0 ? (
        <RoundFixtures 
          fixtures={orderedFixtures} 
          allTeamScores={allTeamScores} 
          selectedUserId={selectedUserId}
          displayedRound={displayedRound} 
        />
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-yellow-700">No fixtures available for this round.</p>
        </div>
      )}
    </div>
  );
}

// Component for Opening Round summary
function OpeningRoundSummary({ allTeamScores, selectedUserId }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <h3 className="text-lg font-semibold text-blue-800 mb-2">Opening Round Information</h3>
      <p className="text-blue-700 mb-4">Current team scores for the Opening Round:</p>
      
      {/* Display all teams with their scores for Opening Round */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        {Object.entries(USER_NAMES).map(([userId, userName]) => {
          // Get the team score, treat null, undefined, NaN as 0
          const score = allTeamScores.find(s => s.userId === userId)?.totalScore || 0;
          
          // Only teams with scores > 0 should be considered for rankings
          const validScores = allTeamScores
            .filter(s => (s.totalScore || 0) > 0)
            .sort((a, b) => b.totalScore - a.totalScore);
          
          // Get rank of this team (only if they have a score > 0)
          const rank = score > 0 
            ? validScores.findIndex(s => s.userId === userId) + 1 
            : '-';
            
          const isTopFour = rank !== '-' && rank <= 4;
          
          return (
            <div key={userId} className={`${
              isTopFour ? 'bg-green-50 border-green-200' : 'bg-white'
            } rounded-lg shadow-md p-3`}>
              <div className="text-center font-medium">
                {userName}
                {userId === selectedUserId && (
                  <span className="ml-2 text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                    Selected
                  </span>
                )}
              </div>
              <div className="text-center text-2xl font-bold my-2">
                {score}
              </div>
              <div className="text-center text-sm">
                {score > 0 ? (
                  <span className="text-gray-600">
                    Rank: {rank}
                  </span>
                ) : (
                  <span className="text-gray-600">
                    Score: 0
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Component for regular round fixtures
function RoundFixtures({ fixtures, allTeamScores, selectedUserId, displayedRound }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {fixtures.map((fixture, index) => {
        // Highlight the selected user's match
        const isSelectedUserMatch = selectedUserId && 
          (String(fixture.home) === String(selectedUserId) || String(fixture.away) === String(selectedUserId));
        
        // Get scores
        const homeScore = allTeamScores.find(s => String(s.userId) === String(fixture.home))?.totalScore || 0;
        const awayScore = allTeamScores.find(s => String(s.userId) === String(fixture.away))?.totalScore || 0;
        
        return (
          <div 
            key={fixture.home + '-' + fixture.away} 
            className={`${
              isSelectedUserMatch 
                ? 'bg-blue-50 border-blue-200' 
                : 'bg-white'
            } rounded-lg shadow-md p-3 order-${index}`}
          >
            <div className="text-center text-sm text-gray-500 mb-2">
              Game {index + 1}
              {isSelectedUserMatch && (
                <span className="ml-2 text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                  Your Match
                </span>
              )}
            </div>
            <div className="flex justify-between items-center">
              <div className="text-center flex-1">
                <div className={`font-medium ${String(fixture.home) === String(selectedUserId) ? 'text-blue-600 font-bold' : ''}`}>
                  {USER_NAMES[fixture.home] || fixture.home}
                </div>
                <div className="text-2xl font-bold">
                  {homeScore}
                </div>
              </div>
              <div className="text-center text-gray-500 px-2">vs</div>
              <div className="text-center flex-1">
                <div className={`font-medium ${String(fixture.away) === String(selectedUserId) ? 'text-blue-600 font-bold' : ''}`}>
                  {USER_NAMES[fixture.away] || fixture.away}
                </div>
                <div className="text-2xl font-bold">
                  {awayScore}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Component for finals fixtures with ladder integration
function FinalsFixtures({ fixtures, allTeamScores, selectedUserId, displayedRound }) {
  // Helper to render a match card
  const renderMatchCard = (fixture, index) => {
    const isSelectedUserMatch = selectedUserId && 
      (String(fixture.home) === String(selectedUserId) || String(fixture.away) === String(selectedUserId));
    
    // Handle pending fixtures
    if (fixture.pending || fixture.home === 'TBD' || fixture.away === 'TBD') {
      return (
        <div 
          key={`finals-${index}`}
          className="bg-gray-50 rounded-lg shadow-md p-4 border-2 border-gray-200"
        >
          <div className="text-center text-sm font-semibold text-gray-600 mb-3">
            {fixture.name || `Match ${index + 1}`}
          </div>
          <div className="flex justify-between items-center">
            <div className="text-center flex-1">
              <div className="text-sm text-gray-500">
                {fixture.homeName || 'TBD'}
              </div>
            </div>
            <div className="text-center text-gray-400 px-2">vs</div>
            <div className="text-center flex-1">
              <div className="text-sm text-gray-500">
                {fixture.awayName || 'TBD'}
              </div>
            </div>
          </div>
          {fixture.note && (
            <div className="text-center text-xs text-gray-500 mt-3 italic">
              {fixture.note}
            </div>
          )}
        </div>
      );
    }
    
    // Get scores for completed fixtures
    const homeScore = allTeamScores.find(s => String(s.userId) === String(fixture.home))?.totalScore || 0;
    const awayScore = allTeamScores.find(s => String(s.userId) === String(fixture.away))?.totalScore || 0;
    const hasResult = homeScore > 0 || awayScore > 0;
    const homeWins = hasResult && homeScore > awayScore;
    const awayWins = hasResult && awayScore > homeScore;
    
    return (
      <div 
        key={`finals-${index}`}
        className={`${
          isSelectedUserMatch 
            ? 'bg-blue-50 border-blue-300 border-2' 
            : 'bg-white border-gray-200 border'
        } rounded-lg shadow-md p-4`}
      >
        <div className="text-center text-sm font-semibold text-gray-700 mb-3">
          {fixture.name || `Match ${index + 1}`}
          {isSelectedUserMatch && (
            <span className="ml-2 text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
              Your Match
            </span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <div className={`text-center flex-1 ${homeWins ? 'opacity-100' : hasResult ? 'opacity-50' : ''}`}>
            <div className={`font-medium ${String(fixture.home) === String(selectedUserId) ? 'text-blue-600 font-bold' : ''}`}>
              {fixture.homeName || USER_NAMES[fixture.home] || fixture.home}
              {fixture.homePosition && (
                <span className="text-xs text-gray-500 ml-1">
                  ({fixture.homePosition === 1 ? '1st' : 
                    fixture.homePosition === 2 ? '2nd' : 
                    fixture.homePosition === 3 ? '3rd' : '4th'})
                </span>
              )}
            </div>
            <div className={`text-2xl font-bold mt-1 ${homeWins ? 'text-green-600' : ''}`}>
              {homeScore || '-'}
            </div>
            {homeWins && <div className="text-xs text-green-600 font-semibold">WINNER</div>}
          </div>
          <div className="text-center text-gray-500 px-2">vs</div>
          <div className={`text-center flex-1 ${awayWins ? 'opacity-100' : hasResult ? 'opacity-50' : ''}`}>
            <div className={`font-medium ${String(fixture.away) === String(selectedUserId) ? 'text-blue-600 font-bold' : ''}`}>
              {fixture.awayName || USER_NAMES[fixture.away] || fixture.away}
              {fixture.awayPosition && (
                <span className="text-xs text-gray-500 ml-1">
                  ({fixture.awayPosition === 1 ? '1st' : 
                    fixture.awayPosition === 2 ? '2nd' : 
                    fixture.awayPosition === 3 ? '3rd' : '4th'})
                </span>
              )}
            </div>
            <div className={`text-2xl font-bold mt-1 ${awayWins ? 'text-green-600' : ''}`}>
              {awayScore || '-'}
            </div>
            {awayWins && <div className="text-xs text-green-600 font-semibold">WINNER</div>}
          </div>
        </div>
        {fixture.note && (
          <div className="text-center text-xs text-gray-500 mt-3 italic">
            {fixture.note}
          </div>
        )}
      </div>
    );
  };
  
  // Render based on round
  if (displayedRound === 22) {
    // Semi Finals - 2 matches
    return (
      <div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p className="text-yellow-800 font-semibold">Semi Finals Week</p>
          <p className="text-yellow-700 text-sm">
            Winner of 1st vs 2nd advances directly to Grand Final. 
            Winner of 3rd vs 4th advances to Preliminary Final.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {fixtures.map((fixture, index) => renderMatchCard(fixture, index))}
        </div>
      </div>
    );
  } else if (displayedRound === 23) {
    // Preliminary Final - 1 match
    return (
      <div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p className="text-yellow-800 font-semibold">Preliminary Final</p>
          <p className="text-yellow-700 text-sm">
            Loser of Semi Final 1 vs Winner of Semi Final 2. 
            Winner advances to Grand Final.
          </p>
        </div>
        <div className="max-w-2xl mx-auto mb-6">
          {fixtures.map((fixture, index) => renderMatchCard(fixture, index))}
        </div>
      </div>
    );
  } else if (displayedRound === 24) {
    // Grand Final - 1 match
    return (
      <div>
        <div className="bg-gradient-to-r from-yellow-50 to-yellow-100 border-2 border-yellow-300 rounded-lg p-4 mb-4">
          <p className="text-yellow-900 font-bold text-lg text-center">🏆 GRAND FINAL 🏆</p>
          <p className="text-yellow-800 text-sm text-center mt-1">
            Winner of Semi Final 1 vs Winner of Preliminary Final
          </p>
        </div>
        <div className="max-w-2xl mx-auto mb-6">
          {fixtures.map((fixture, index) => renderMatchCard(fixture, index))}
        </div>
      </div>
    );
  }
  
  // Default fallback
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {fixtures.map((fixture, index) => renderMatchCard(fixture, index))}
    </div>
  );
}
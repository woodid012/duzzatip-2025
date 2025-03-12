'use client'

import { USER_NAMES } from '@/app/lib/constants';
import { isFinalRound } from '@/app/lib/ladder_utils';

// Component for displaying round summary and fixtures
export default function RoundSummary({ 
  displayedRound, 
  roundName, 
  orderedFixtures, 
  allTeamScores, 
  selectedUserId,
  hasSubstitutions
}) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold mb-4">{roundName}</h2>
      
      {/* Substitution status indicator for regular rounds */}
      {displayedRound >= 1 && (
        <div className={`mb-4 p-2 rounded-lg text-sm ${hasSubstitutions ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-yellow-50 text-yellow-800 border border-yellow-200'}`}>
          <span className="font-semibold">Substitution Status:</span> {hasSubstitutions ? 'Enabled' : 'Disabled'} 
          {!hasSubstitutions && displayedRound >= 1 && (
            <span> - Substitutions will be applied after the round ends</span>
          )}
        </div>
      )}
      
      {displayedRound === 0 ? (
        <OpeningRoundSummary 
          allTeamScores={allTeamScores} 
          selectedUserId={selectedUserId} 
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

// Component for round fixtures
function RoundFixtures({ fixtures, allTeamScores, selectedUserId, displayedRound }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {fixtures.map((fixture, index) => {
        // Highlight the selected user's match
        const isSelectedUserMatch = selectedUserId && 
          (String(fixture.home) === String(selectedUserId) || String(fixture.away) === String(selectedUserId));
        
        // Get home score - ensure consistent type comparison by converting both to strings
        const homeScore = allTeamScores.find(s => String(s.userId) === String(fixture.home))?.totalScore;
        
        // Get away score - ensure consistent type comparison by converting both to strings
        const awayScore = allTeamScores.find(s => String(s.userId) === String(fixture.away))?.totalScore;
        
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
              {isFinalRound(displayedRound) ? fixture.name || `Final ${index + 1}` : `Game ${index + 1}`}
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
                  {homeScore !== undefined ? homeScore : '-'}
                </div>
              </div>
              <div className="text-center text-gray-500 px-2">vs</div>
              <div className="text-center flex-1">
                <div className={`font-medium ${String(fixture.away) === String(selectedUserId) ? 'text-blue-600 font-bold' : ''}`}>
                  {USER_NAMES[fixture.away] || fixture.away}
                </div>
                <div className="text-2xl font-bold">
                  {awayScore !== undefined ? awayScore : '-'}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
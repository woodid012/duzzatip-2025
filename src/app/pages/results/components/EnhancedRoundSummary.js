// src/app/pages/results/components/EnhancedRoundSummary.js

'use client'

import { USER_NAMES, TEAM_LOGOS } from '@/app/lib/constants';

// Component for displaying round summary and fixtures
export default function EnhancedRoundSummary({
  displayedRound,
  roundName,
  orderedFixtures,
  allTeamScores,
  selectedUserId,
  hasSubstitutions,
  isFinals,
  liveUserIds = [],
  onTeamOpen,
}) {
  return (
    <div className="mb-6">
      {/* Section header */}
      {displayedRound !== 0 && !isFinals && (
        <div className="mb-[13px] flex items-baseline gap-[10px]">
          <h2 className="text-[15px] font-extrabold uppercase tracking-[0.02em] text-slate-900">Fixtures</h2>
          <span className="text-[13px] text-slate-400">{roundName} · tap a team to jump to its card</span>
        </div>
      )}

      {displayedRound === 0 ? (
        <OpeningRoundSummary
          allTeamScores={allTeamScores}
          selectedUserId={selectedUserId}
          onTeamOpen={onTeamOpen}
        />
      ) : isFinals ? (
        <FinalsFixtures
          fixtures={orderedFixtures}
          allTeamScores={allTeamScores}
          selectedUserId={selectedUserId}
          displayedRound={displayedRound}
          onTeamOpen={onTeamOpen}
        />
      ) : orderedFixtures && orderedFixtures.length > 0 ? (
        <RoundFixtures
          fixtures={orderedFixtures}
          allTeamScores={allTeamScores}
          selectedUserId={selectedUserId}
          displayedRound={displayedRound}
          liveUserIds={liveUserIds}
          onTeamOpen={onTeamOpen}
        />
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-amber-700">No fixtures available for this round.</p>
        </div>
      )}
    </div>
  );
}

// Component for Opening Round summary
function OpeningRoundSummary({ allTeamScores, selectedUserId, onTeamOpen }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <h3 className="text-lg font-semibold text-blue-800 mb-2">Opening Round Information</h3>
      <p className="text-blue-700 mb-4">Current team scores for the Opening Round:</p>
      
      {/* Display all teams with their scores for Opening Round */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mt-4">
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
            <button
              type="button"
              key={userId}
              onClick={() => { onTeamOpen?.(String(userId)); scrollToTeamCard(userId); }}
              className={`${
                isTopFour ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'
              } border rounded-xl shadow-sm p-2 sm:p-3 text-left w-full cursor-pointer hover:brightness-95 active:brightness-90 transition`}
            >
              <div className="text-center font-medium text-xs sm:text-base">
                <div className="text-lg sm:text-2xl mb-0.5 sm:mb-1">{TEAM_LOGOS[userId]}</div>
                <div className="truncate">{userName}</div>
                {userId === selectedUserId && (
                  <span className="ml-1 text-xs px-1 sm:px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                    Selected
                  </span>
                )}
              </div>
              <div className="text-center text-lg sm:text-2xl font-bold my-1 sm:my-2">
                {score}
              </div>
              <div className="text-center text-xs sm:text-sm">
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Helper to check if a team has any live games
function hasLiveGames(teamScoreData) {
  if (!teamScoreData) return false;
  return teamScoreData.positionScores?.some(p => p.isGameLive) ||
    teamScoreData.benchScores?.some(b => b.isGameLive);
}

// Scroll the matching team card into view. Both mobile and desktop variants
// share the same id, so pick the one currently visible (display: block).
function scrollToTeamCard(userId) {
  if (!userId) return;
  if (typeof document === 'undefined') return;
  const candidates = document.querySelectorAll(`[id="team-card-${userId}"]`);
  const visible = Array.from(candidates).find(el => el.offsetParent !== null) || candidates[0];
  if (visible) {
    visible.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// One clickable team row inside a fixture mini-scoreboard.
function FixtureTeamRow({ userId, score, isWinner, isLive, isYou, onClick }) {
  return (
    <div onClick={onClick} className="flex cursor-pointer items-center gap-[9px] rounded-[9px] px-1 py-[7px] hover:bg-slate-50">
      <span className="text-[19px] leading-none">{TEAM_LOGOS[userId]}</span>
      <span className={`min-w-0 flex-1 truncate text-[13px] ${isWinner ? 'font-bold text-slate-900' : 'font-medium text-slate-500'} ${isYou ? '!text-blue-600' : ''}`}>
        {USER_NAMES[userId] || userId}
      </span>
      <span className={`inline-flex items-center text-[20px] font-extrabold tabular-nums ${isLive ? 'text-amber-600' : isWinner ? 'text-emerald-600' : 'text-slate-400'}`}>
        {isLive && <span className="mr-[5px] inline-block h-[6px] w-[6px] rounded-full bg-amber-600 animate-pulse-dot" />}
        {score}
      </span>
    </div>
  );
}

// Component for regular round fixtures — mini-scoreboards.
function RoundFixtures({ fixtures, allTeamScores, selectedUserId, displayedRound, liveUserIds = [], onTeamOpen }) {
  // Clicking either team in a matchup opens BOTH cards, then scrolls to the one tapped.
  const jump = (fixture, uid) => {
    onTeamOpen?.(String(fixture.home));
    onTeamOpen?.(String(fixture.away));
    scrollToTeamCard(uid);
  };
  return (
    <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
      {fixtures.map((fixture, index) => {
        const yourMatch = selectedUserId &&
          (String(fixture.home) === String(selectedUserId) || String(fixture.away) === String(selectedUserId));

        const homeScore = allTeamScores.find(s => String(s.userId) === String(fixture.home))?.totalScore || 0;
        const awayScore = allTeamScores.find(s => String(s.userId) === String(fixture.away))?.totalScore || 0;
        const homeLive = liveUserIds.includes(String(fixture.home));
        const awayLive = liveUserIds.includes(String(fixture.away));
        const live = homeLive || awayLive;
        const homeWin = homeScore > awayScore;
        const awayWin = awayScore > homeScore;

        return (
          <div
            key={fixture.home + '-' + fixture.away}
            className={`relative overflow-hidden rounded-[15px] bg-white px-[13px] pb-3 pt-[11px] ${
              yourMatch
                ? 'border border-blue-200 shadow-[0_0_0_3px_rgba(37,99,235,0.07)]'
                : live
                  ? 'border border-amber-200'
                  : 'border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
            }`}
          >
            {yourMatch && (
              <div className="absolute right-0 top-0 rounded-[0_14px_0_10px] bg-blue-600 px-[9px] py-[3px] text-[9px] font-extrabold tracking-[0.1em] text-white">
                YOUR MATCH
              </div>
            )}
            <div className={`mb-[3px] text-[10px] font-extrabold uppercase tracking-[0.1em] ${live ? 'text-amber-600' : 'text-slate-400'}`}>
              Game {index + 1}{live ? ' · Live' : ''}
            </div>
            <FixtureTeamRow
              userId={fixture.home} score={homeScore} isWinner={homeWin} isLive={homeLive}
              isYou={String(fixture.home) === String(selectedUserId)} onClick={() => jump(fixture, fixture.home)}
            />
            <div className="mx-1 my-[1px] h-px bg-slate-100" />
            <FixtureTeamRow
              userId={fixture.away} score={awayScore} isWinner={awayWin} isLive={awayLive}
              isYou={String(fixture.away) === String(selectedUserId)} onClick={() => jump(fixture, fixture.away)}
            />
          </div>
        );
      })}
    </div>
  );
}

// Component for finals fixtures with ladder integration
function FinalsFixtures({ fixtures, allTeamScores, selectedUserId, displayedRound, onTeamOpen }) {
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
            <div className="text-center flex-1 min-w-0">
              <div className="text-sm text-gray-500">
                {fixture.homeName || 'TBD'}
              </div>
            </div>
            <div className="text-center text-gray-400 px-2">vs</div>
            <div className="text-center flex-1 min-w-0">
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

    // Get scores and live status for completed fixtures
    const homeTeamData = allTeamScores.find(s => String(s.userId) === String(fixture.home));
    const awayTeamData = allTeamScores.find(s => String(s.userId) === String(fixture.away));
    const homeScore = homeTeamData?.totalScore || 0;
    const awayScore = awayTeamData?.totalScore || 0;
    const hasResult = homeScore > 0 || awayScore > 0;
    const homeWins = hasResult && homeScore > awayScore;
    const awayWins = hasResult && awayScore > homeScore;
    const homeLive = hasLiveGames(homeTeamData);
    const awayLive = hasLiveGames(awayTeamData);
    const matchHasLive = homeLive || awayLive;

    const finalsJumpTarget = (selectedUserId && String(fixture.away) === String(selectedUserId))
      ? fixture.away
      : fixture.home;

    return (
      <button
        type="button"
        key={`finals-${index}`}
        onClick={() => {
          if (fixture.home && fixture.home !== 'TBD') onTeamOpen?.(String(fixture.home));
          if (fixture.away && fixture.away !== 'TBD') onTeamOpen?.(String(fixture.away));
          scrollToTeamCard(finalsJumpTarget);
        }}
        className={`${
          isSelectedUserMatch
            ? 'bg-blue-50 border-blue-300 border-2'
            : matchHasLive
              ? 'bg-amber-50 border-amber-200 border-2'
              : 'bg-white border-gray-200 border'
        } w-full text-left rounded-lg shadow-md p-4 cursor-pointer hover:shadow-xl hover:ring-2 hover:ring-blue-400 active:shadow-md transition`}
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
          <div
            className={`text-center flex-1 min-w-0 ${homeWins ? 'opacity-100' : hasResult ? 'opacity-50' : ''}`}
          >
            <div className="text-2xl mb-1">{TEAM_LOGOS[fixture.home]}</div>
            <div className={`font-medium text-sm ${String(fixture.home) === String(selectedUserId) ? 'text-blue-600 font-bold' : ''}`}>
              {fixture.homeName || USER_NAMES[fixture.home] || fixture.home}
              {fixture.homePosition && (
                <span className="text-xs text-gray-500 ml-1">
                  ({fixture.homePosition === 1 ? '1st' :
                    fixture.homePosition === 2 ? '2nd' :
                    fixture.homePosition === 3 ? '3rd' : '4th'})
                </span>
              )}
            </div>
            <div className={`text-2xl font-bold mt-1 ${homeWins ? 'text-green-600' : homeLive ? 'text-amber-600' : ''}`}>
              {homeLive && <span className="inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse mr-1 align-middle" />}
              {homeScore || '-'}
            </div>
            {homeWins && <div className="text-xs text-green-600 font-semibold">WINNER</div>}
          </div>
          <div className="text-center text-gray-500 px-2">vs</div>
          <div
            className={`text-center flex-1 min-w-0 ${awayWins ? 'opacity-100' : hasResult ? 'opacity-50' : ''}`}
          >
            <div className="text-2xl mb-1">{TEAM_LOGOS[fixture.away]}</div>
            <div className={`font-medium text-sm ${String(fixture.away) === String(selectedUserId) ? 'text-blue-600 font-bold' : ''}`}>
              {fixture.awayName || USER_NAMES[fixture.away] || fixture.away}
              {fixture.awayPosition && (
                <span className="text-xs text-gray-500 ml-1">
                  ({fixture.awayPosition === 1 ? '1st' :
                    fixture.awayPosition === 2 ? '2nd' :
                    fixture.awayPosition === 3 ? '3rd' : '4th'})
                </span>
              )}
            </div>
            <div className={`text-2xl font-bold mt-1 ${awayWins ? 'text-green-600' : awayLive ? 'text-amber-600' : ''}`}>
              {awayLive && <span className="inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse mr-1 align-middle" />}
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
      </button>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6">
      {fixtures.map((fixture, index) => renderMatchCard(fixture, index))}
    </div>
  );
}
'use client';

import { useEffect, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { useUserContext } from '../layout';
import useTipping from '@/app/hooks/useTipping';
import { USER_NAMES, TEAM_LOGOS, CURRENT_YEAR } from '@/app/lib/constants';
import { useToast } from '@/app/components/Toast';
import ScoreboardHeader from '@/app/components/ScoreboardHeader';

export default function TippingPage() {
  // Get data from our app context
  const { currentRound, roundInfo, getSpecificRoundInfo } = useAppContext();
  
  // Get selected user context
  const { selectedUserId } = useUserContext();
  
  // For tracking button clicks
  const editClickedRef = useRef(false);
  
  // Format date for display
  const formatDate = (date) => {
    if (!date) return 'Never';
    
    return date.toLocaleString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    });
  };
  
  // Get tipping functionality from our hook
  const {
    selectedUserId: hookSelectedUserId,
    tips,
    roundFixtures,
    isEditing,
    loading,
    error,
    successMessage,
    dataLoaded,
    lastEditedTime,
    localRound,
    isRoundLocked,
    isLateSubmission,
    isPastYear,
    formatRoundName,
    handleRoundChange,
    handleTipSelect,
    handleDeadCertToggle,
    saveTips,
    cancelEditing,
    startEditing,
    changeUser
  } = useTipping(selectedUserId === 'admin' ? '' : selectedUserId, { isAdmin: selectedUserId === 'admin' });

  // For admin mode, don't sync with global context changes
  // Admin mode manages its own team selection locally
  useEffect(() => {
    if (selectedUserId && selectedUserId !== 'admin' && selectedUserId !== hookSelectedUserId) {
      console.log(`Syncing selected user from context (non-admin): ${selectedUserId}`);
      changeUser(selectedUserId);
    }
  }, [selectedUserId, hookSelectedUserId, changeUser]);

  // Initialize with global current round on first render
  useEffect(() => {
    if (currentRound !== undefined && localRound === undefined) {
      handleRoundChange(currentRound);
    }
  }, [currentRound, localRound, handleRoundChange]);

  // Handle edit button click with debounce
  const handleEditClick = () => {
    // Prevent multiple rapid clicks
    if (editClickedRef.current) return;
    
    // Set flag to prevent additional clicks
    editClickedRef.current = true;
    
    console.log("Edit button clicked");
    startEditing();
    
    // Reset flag after a short delay
    setTimeout(() => {
      editClickedRef.current = false;
    }, 300);
  };

  // Prevent form submission
  const handleFormSubmit = (e) => {
    e.preventDefault();
    console.log("Form submission prevented");
    return false;
  };

  const { addToast } = useToast();

  // Wrap saveTips to show toast
  const handleSaveTips = async () => {
    const result = await saveTips();
    if (result) {
      addToast('Tips saved!', 'success');
    } else {
      addToast('Failed to save tips', 'error');
    }
  };

  // Check if user is admin
  const isAdmin = selectedUserId === 'admin';

  // Get the current team being edited for display - FIXED LOGIC
  const currentTeamBeingEdited = (() => {
    if (isAdmin && hookSelectedUserId && hookSelectedUserId !== 'admin') {
      // Admin mode with a specific team selected
      return hookSelectedUserId;
    } else if (!isAdmin && selectedUserId && selectedUserId !== 'admin') {
      // Regular user mode
      return selectedUserId;
    }
    return null;
  })();

  // Get display name for the current team
  const currentTeamDisplayName = currentTeamBeingEdited ? USER_NAMES[currentTeamBeingEdited] : null;

  if (loading && !dataLoaded) {
    return (
      <div className="p-4 md:p-8">
        {/* Skeleton header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="h-7 w-48 bg-gray-200 rounded animate-pulse mb-2"></div>
            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse"></div>
          </div>
          <div className="h-10 w-24 bg-gray-200 rounded animate-pulse"></div>
        </div>
        {/* Skeleton fixtures */}
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg p-4 shadow">
              <div className="h-3 w-32 bg-gray-200 rounded animate-pulse mb-3"></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="h-14 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-14 bg-gray-200 rounded-lg animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // If no user is selected and not admin, show a message
  if (!selectedUserId && !hookSelectedUserId) {
    return (
      <div className="text-center p-10">
        <h2 className="dz-title mb-4">Please Select a Player</h2>
        <p className="dz-subtitle">
          Use the dropdown in the top right to select which player's tips you want to view or edit.
        </p>
      </div>
    );
  }

  // Use the displayed round's lockout, not the global currentRound's lockout
  const localRoundInfo = localRound !== undefined
    ? { ...roundInfo, lockoutTime: getSpecificRoundInfo(localRound)?.lockoutTime ?? roundInfo.lockoutTime }
    : roundInfo;

  return (
    <>
      {/* MOBILE VIEW - Visible only on small screens */}
      <div className="block md:hidden">
        <MobileTippingView
          currentTeamDisplayName={currentTeamDisplayName}
          isAdmin={isAdmin}
          currentTeamBeingEdited={currentTeamBeingEdited}
          roundInfo={localRoundInfo}
          isRoundLocked={isRoundLocked}
          isLateSubmission={isLateSubmission}
          isPastYear={isPastYear}
          localRound={localRound}
          formatRoundName={formatRoundName}
          lastEditedTime={lastEditedTime}
          formatDate={formatDate}
          successMessage={successMessage}
          error={error}
          isEditing={isEditing}
          handleEditClick={handleEditClick}
          saveTips={handleSaveTips}
          cancelEditing={cancelEditing}
          handleRoundChange={handleRoundChange}
          hookSelectedUserId={hookSelectedUserId}
          changeUser={changeUser}
          roundFixtures={roundFixtures}
          tips={tips}
          handleTipSelect={handleTipSelect}
          handleDeadCertToggle={handleDeadCertToggle}
          handleFormSubmit={handleFormSubmit}
        />
      </div>

      {/* DESKTOP VIEW - Hidden on small screens */}
      <div className="hidden md:block">
        <DesktopTippingView
          currentTeamDisplayName={currentTeamDisplayName}
          isAdmin={isAdmin}
          currentTeamBeingEdited={currentTeamBeingEdited}
          roundInfo={localRoundInfo}
          isRoundLocked={isRoundLocked}
          isLateSubmission={isLateSubmission}
          isPastYear={isPastYear}
          localRound={localRound}
          formatRoundName={formatRoundName}
          lastEditedTime={lastEditedTime}
          formatDate={formatDate}
          successMessage={successMessage}
          error={error}
          isEditing={isEditing}
          handleEditClick={handleEditClick}
          saveTips={handleSaveTips}
          cancelEditing={cancelEditing}
          handleRoundChange={handleRoundChange}
          hookSelectedUserId={hookSelectedUserId}
          changeUser={changeUser}
          roundFixtures={roundFixtures}
          tips={tips}
          handleTipSelect={handleTipSelect}
          handleDeadCertToggle={handleDeadCertToggle}
          handleFormSubmit={handleFormSubmit}
        />
      </div>
    </>
  );
}

// Mobile Component — clean light theme matching the mobile results scoreboard
function MobileTippingView({
  currentTeamDisplayName,
  isAdmin,
  currentTeamBeingEdited,
  roundInfo,
  isRoundLocked,
  isLateSubmission,
  isPastYear,
  localRound,
  formatRoundName,
  lastEditedTime,
  formatDate,
  successMessage,
  error,
  isEditing,
  handleEditClick,
  saveTips,
  cancelEditing,
  handleRoundChange,
  hookSelectedUserId,
  changeUser,
  roundFixtures,
  tips,
  handleTipSelect,
  handleDeadCertToggle,
  handleFormSubmit
}) {
  const teamId = currentTeamBeingEdited;
  const logo = teamId ? TEAM_LOGOS[teamId] : null;
  const fixtures = roundFixtures || [];
  const tippedCount = fixtures.filter((f) => tips[f.MatchNumber]?.team && !tips[f.MatchNumber]?.isDefault).length;
  const deadCertCount = fixtures.filter((f) => tips[f.MatchNumber]?.deadCert).length;
  const pct = fixtures.length ? (tippedCount / fixtures.length) * 100 : 0;
  const locked = isRoundLocked && !isAdmin;
  const late = isLateSubmission && !isAdmin;

  return (
    <div className="px-4 pb-10 pt-2 space-y-4 text-slate-700">
      {/* Header — eyebrow + headline on the left, round/team controls on the right */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${late ? 'text-orange-500' : 'text-amber-600'}`}>
            {formatRoundName(localRound)}
            {locked ? ' · Locked' : late ? ' · Late' : ' · Open'}
            {isAdmin && isRoundLocked ? ' · Admin' : ''}
          </div>
          <h1 className="mt-0.5 text-[27px] font-black tracking-[-0.03em] leading-none text-slate-900">
            Tips
          </h1>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {locked && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 border border-slate-300 px-2.5 py-1 text-[11px] font-extrabold tracking-[0.04em] text-slate-600">
              🔒 LOCKED
            </span>
          )}
          <select
            value={localRound}
            onChange={(e) => handleRoundChange(Number(e.target.value))}
            className="dz-select py-1.5 text-sm"
          >
            {[...Array(25)].map((_, i) => (
              <option key={i} value={i}>{formatRoundName(i)}</option>
            ))}
          </select>
          {isAdmin && (
            <select
              value={hookSelectedUserId || ''}
              onChange={(e) => changeUser(e.target.value)}
              className="dz-select py-1.5 text-sm"
            >
              <option value="">{currentTeamDisplayName ? `Editing: ${currentTeamDisplayName}` : 'Select a team'}</option>
              {Object.entries(USER_NAMES).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Identity + progress card — shows who you are and how far along you are */}
      {teamId && (
        <div className="rounded-[22px] border border-blue-200 bg-blue-50 p-4 shadow-[0_10px_30px_-18px_rgba(37,99,235,0.45)]">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[26px] leading-none">{logo}</span>
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-900 truncate max-w-[170px]">{currentTeamDisplayName}</div>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-blue-600">
                  {isAdmin ? 'Admin editing' : 'Your tips'}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[28px] font-black leading-none tabular-nums text-slate-900">
                {tippedCount}<span className="text-[18px] text-slate-400">/{fixtures.length}</span>
              </div>
              <div className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-500">Tipped</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex h-[7px] rounded-full overflow-hidden bg-slate-200">
            <div className="bg-gradient-to-r from-blue-500 to-blue-400" style={{ width: `${pct}%` }} />
          </div>

          {/* Meta line */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {deadCertCount > 0 && (
              <span className="font-semibold text-amber-600">⭐ {deadCertCount} dead cert{deadCertCount > 1 ? 's' : ''}</span>
            )}
            {roundInfo.lockoutTime && (
              <span>Lockout <span className="font-semibold text-slate-700">{roundInfo.lockoutTime}</span></span>
            )}
            {lastEditedTime && (
              <span>Saved <span className="font-semibold text-slate-700">{formatDate(lastEditedTime)}</span></span>
            )}
          </div>
        </div>
      )}

      {/* Status messages */}
      {successMessage && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 p-2.5 text-xs font-medium">
          {successMessage}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-2.5 text-xs font-medium">
          {error} — check your connection and try again.
        </div>
      )}

      {/* Action buttons */}
      {teamId && !isPastYear && (
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <button
                onClick={saveTips}
                type="button"
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2.5 rounded-xl text-sm font-extrabold"
              >
                Save Tips
              </button>
              <button
                onClick={cancelEditing}
                type="button"
                className="dz-btn-ghost flex-1 justify-center text-sm"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={handleEditClick}
              type="button"
              disabled={locked}
              className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-extrabold ${
                locked ? 'bg-slate-300 cursor-not-allowed text-slate-500' : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {late ? 'Edit Tips (Late)' : 'Edit Tips'}
            </button>
          )}
        </div>
      )}

      {/* Admin: no team selected yet */}
      {isAdmin && !teamId && (
        <div className="rounded-[18px] bg-blue-50 border border-blue-200 p-4">
          <h3 className="text-blue-800 font-extrabold text-sm mb-1">Admin Mode</h3>
          <p className="text-blue-700 text-xs">Pick a team from the dropdown above to view and edit their tips.</p>
        </div>
      )}

      {/* Fixture cards */}
      {(teamId || !isAdmin) && fixtures.length > 0 && (
        <div className="space-y-2.5">
          <div className="px-1 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Match Tips</div>
          <form onSubmit={handleFormSubmit} className="space-y-2.5">
            {fixtures.map((fixture) => {
              const gameHasStarted = new Date() >= new Date(fixture.DateUtc);
              const gameHasResult = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
              const winner = gameHasResult
                ? (fixture.HomeTeamScore > fixture.AwayTeamScore ? fixture.HomeTeam
                   : fixture.AwayTeamScore > fixture.HomeTeamScore ? fixture.AwayTeam
                   : 'Draw')
                : null;
              const tipTeam = tips[fixture.MatchNumber]?.team;
              const deadCert = tips[fixture.MatchNumber]?.deadCert;
              const isCorrectTip = gameHasResult && winner !== 'Draw' && tipTeam === winner;
              const isWrongTip = gameHasResult && winner !== 'Draw' && tipTeam !== winner;
              const gameLocked = (gameHasStarted && !isAdmin) || (isRoundLocked && !isAdmin);
              const pickClass = (team) => `p-3 rounded-[13px] text-sm transition-colors min-w-0 border ${
                tipTeam === team
                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                  : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-900'
              } ${(!isEditing || gameLocked) ? 'cursor-not-allowed opacity-60' : ''}`;
              return (
                <div key={fixture.MatchNumber} className="rounded-[18px] border border-slate-200 bg-white shadow-sm p-3">
                  {/* Match info */}
                  <div className="flex justify-between items-center mb-2.5">
                    <div className="text-[11px] font-semibold text-slate-500">
                      Game {fixture.MatchNumber} · {fixture.DateMelb}
                      {gameHasStarted && !gameHasResult && <span className="ml-1 text-amber-600">Live</span>}
                    </div>
                    {isCorrectTip && <span className="text-emerald-600 font-bold text-lg leading-none">✓</span>}
                    {isWrongTip && <span className="text-red-600 font-bold text-lg leading-none">✗</span>}
                    {gameHasResult && winner === 'Draw' && <span className="text-slate-500 text-[11px] font-semibold">Draw</span>}
                  </div>

                  {/* Team picker */}
                  <div className="grid grid-cols-2 gap-2 mb-2.5">
                    <button
                      onClick={(e) => { e.preventDefault(); handleTipSelect(fixture.MatchNumber, fixture.HomeTeam); }}
                      type="button"
                      disabled={!isEditing || gameLocked}
                      className={pickClass(fixture.HomeTeam)}
                    >
                      <div className="text-center min-w-0">
                        <div className="font-extrabold truncate">{fixture.HomeTeam}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] opacity-75">
                          Home{gameHasResult ? ` · ${fixture.HomeTeamScore}` : ''}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); handleTipSelect(fixture.MatchNumber, fixture.AwayTeam); }}
                      type="button"
                      disabled={!isEditing || gameLocked}
                      className={pickClass(fixture.AwayTeam)}
                    >
                      <div className="text-center min-w-0">
                        <div className="font-extrabold truncate">{fixture.AwayTeam}</div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] opacity-75">
                          Away{gameHasResult ? ` · ${fixture.AwayTeamScore}` : ''}
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* Tip + dead cert */}
                  <div className="flex justify-between items-center gap-2">
                    <div className="text-[11px] min-w-0">
                      <span className="text-slate-500">Your tip:</span>
                      <span className="font-bold ml-1 text-slate-900">{tipTeam || 'Not selected'}</span>
                    </div>
                    <button
                      onClick={(e) => { e.preventDefault(); handleDeadCertToggle(fixture.MatchNumber); }}
                      type="button"
                      disabled={!isEditing || gameLocked || !tipTeam}
                      className={`px-3 py-1 rounded-full text-[11px] font-extrabold shrink-0 border ${
                        deadCert
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-white border-slate-200 text-slate-600'
                      } ${(!isEditing || gameLocked || !tipTeam) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-50'}`}
                    >
                      {deadCert ? '⭐ Dead Cert' : 'Dead Cert'}
                    </button>
                  </div>
                </div>
              );
            })}
          </form>
        </div>
      )}

      {/* Admin override note */}
      {isAdmin && (
        <div className="rounded-[18px] bg-amber-50 border border-amber-200 p-4">
          <h3 className="text-sm font-extrabold text-amber-800 mb-1">Admin Override</h3>
          <p className="text-amber-700 text-xs">You can edit tips for any team in any round, even when locked.</p>
          {currentTeamDisplayName && (
            <div className="mt-2 p-2 bg-white rounded-lg border border-amber-200 text-xs text-amber-700">
              Editing <span className="font-extrabold">{currentTeamDisplayName}</span> · {formatRoundName(localRound)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Desktop Component - Original layout
function DesktopTippingView({
  currentTeamDisplayName,
  isAdmin,
  currentTeamBeingEdited,
  roundInfo,
  isRoundLocked,
  isLateSubmission,
  isPastYear,
  localRound,
  formatRoundName,
  lastEditedTime,
  formatDate,
  successMessage,
  error,
  isEditing,
  handleEditClick,
  saveTips,
  cancelEditing,
  handleRoundChange,
  hookSelectedUserId,
  changeUser,
  roundFixtures,
  tips,
  handleTipSelect,
  handleDeadCertToggle,
  handleFormSubmit
}) {
  return (
    <div className="container mx-auto px-4 py-8">
      <ScoreboardHeader
        eyebrow={
          <span className={isLateSubmission && !isAdmin ? "text-orange-300" : undefined}>
            Showing {formatRoundName(localRound)}
            {isLateSubmission && !isAdmin && <span className="ml-2">⚠️ Late submission</span>}
            {isAdmin && isRoundLocked && <span className="ml-2">(Admin Override)</span>}
          </span>
        }
        title={
          currentTeamDisplayName
            ? `${currentTeamDisplayName}'s Tips${isAdmin ? ' (Admin Editing)' : ''}`
            : isAdmin
              ? `AFL ${CURRENT_YEAR} Tips - Admin Mode`
              : `AFL ${CURRENT_YEAR} Tips`
        }
      >
        <div className="flex items-center gap-3">
          <select
            value={localRound}
            onChange={(e) => handleRoundChange(Number(e.target.value))}
            className="dz-select-dark"
          >
            {[...Array(25)].map((_, i) => (
              <option key={i} value={i}>
                {formatRoundName(i)}
              </option>
            ))}
          </select>

          {isAdmin && (
            <select
              value={hookSelectedUserId || ''}
              onChange={(e) => {
                console.log(`Admin selecting team: ${e.target.value}`);
                changeUser(e.target.value);
              }}
              className="dz-select-dark"
            >
              <option value="">
                {currentTeamDisplayName
                  ? `Currently Editing: ${currentTeamDisplayName}`
                  : 'Select a team to edit'}
              </option>
              {Object.entries(USER_NAMES).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}

          {/* Only show edit buttons if we have a team selected and not viewing a past year */}
          {currentTeamBeingEdited && !isPastYear && (
            isEditing ? (
              <>
                <button
                  onClick={saveTips}
                  type="button"
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded"
                >
                  Save Changes
                </button>
                <button
                  onClick={cancelEditing}
                  type="button"
                  className="dz-btn-ghost"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={handleEditClick}
                type="button"
                disabled={isRoundLocked && !isAdmin}
                className={`px-4 py-2 rounded ${
                  isRoundLocked && !isAdmin
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600'
                } text-white`}
              >
                {isLateSubmission && !isAdmin ? 'Edit Tips (Late)' : 'Edit Tips'}
              </button>
            )
          )}
        </div>

        <div className="flex flex-col items-end gap-0.5 text-[11px] text-slate-400">
          {roundInfo.lockoutTime && (
            <div>
              <span>Lockout:</span>
              <span className="font-medium text-slate-200 ml-1">{roundInfo.lockoutTime}</span>
              {isLateSubmission && !isAdmin && (
                <span className="text-orange-300 ml-1">(Late)</span>
              )}
            </div>
          )}
          {lastEditedTime && currentTeamBeingEdited && (
            <div>
              <span>Last Submitted:</span>
              <span className="font-medium ml-1 text-slate-200">
                {formatDate(lastEditedTime)}
              </span>
            </div>
          )}
          {successMessage && (
            <span className="text-emerald-300">{successMessage}</span>
          )}
          {error && (
            <span className="text-red-300">{error}</span>
          )}
        </div>
      </ScoreboardHeader>

      {/* Show message if admin but no team selected */}
      {isAdmin && !currentTeamBeingEdited && (
        <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 mb-6">
          <h3 className="text-blue-800 font-semibold mb-2">Admin Mode</h3>
          <p className="text-blue-700">
            Select a team from the dropdown above to view and edit their tips.
          </p>
        </div>
      )}

      {/* Show fixtures table only if we have a team selected or it's not admin mode */}
      {(currentTeamBeingEdited || !isAdmin) && roundFixtures.length > 0 && (
        <div className="dz-surface overflow-x-auto">
          <form onSubmit={handleFormSubmit}>
            <table className="min-w-full">
              <thead>
                <tr className="bg-slate-100">
                  <th className="py-2 px-4 border border-slate-200 text-slate-900">Date</th>
                  <th className="py-2 px-4 border border-slate-200 text-slate-900">Home Team</th>
                  <th className="py-2 px-4 border border-slate-200 text-slate-900">Away Team</th>
                  <th className="py-2 px-4 border border-slate-200 text-slate-900">Your Tip</th>
                  <th className="py-2 px-4 border border-slate-200 text-slate-900">Dead Cert</th>
                  <th className="py-2 px-4 border border-slate-200 text-slate-900">Result</th>
                </tr>
              </thead>
              <tbody className="text-slate-900">
                {roundFixtures.map((fixture) => {
                  const gameHasStarted = new Date() >= new Date(fixture.DateUtc);
                  const gameHasResult = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
                  const winner = gameHasResult
                    ? (fixture.HomeTeamScore > fixture.AwayTeamScore ? fixture.HomeTeam
                       : fixture.AwayTeamScore > fixture.HomeTeamScore ? fixture.AwayTeam
                       : 'Draw')
                    : null;
                  const tipTeam = tips[fixture.MatchNumber]?.team;
                  const isCorrectTip = gameHasResult && winner !== 'Draw' && tipTeam === winner;
                  const isWrongTip = gameHasResult && winner !== 'Draw' && tipTeam !== winner;
                  const gameLocked = (gameHasStarted && !isAdmin) || (isRoundLocked && !isAdmin);
                  return (
                  <tr key={fixture.MatchNumber} className={`hover:bg-slate-50 ${gameHasStarted && !gameHasResult ? 'bg-yellow-50' : ''}`}>
                    <td className="py-2 px-4 border border-slate-200 text-slate-900 text-sm">
                      {fixture.DateMelb}
                      {gameHasStarted && !gameHasResult && <div className="text-xs text-yellow-600">In progress</div>}
                    </td>
                    <td className="py-2 px-4 border border-slate-200">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleTipSelect(fixture.MatchNumber, fixture.HomeTeam);
                        }}
                        type="button"
                        disabled={!isEditing || gameLocked}
                        className={`px-3 py-1 rounded ${
                          tips[fixture.MatchNumber]?.team === fixture.HomeTeam
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
                        } ${(!isEditing || gameLocked) ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        {fixture.HomeTeam}
                        {gameHasResult && <span className="ml-1 text-xs">({fixture.HomeTeamScore})</span>}
                      </button>
                    </td>
                    <td className="py-2 px-4 border border-slate-200">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleTipSelect(fixture.MatchNumber, fixture.AwayTeam);
                        }}
                        type="button"
                        disabled={!isEditing || gameLocked}
                        className={`px-3 py-1 rounded ${
                          tips[fixture.MatchNumber]?.team === fixture.AwayTeam
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
                        } ${(!isEditing || gameLocked) ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        {fixture.AwayTeam}
                        {gameHasResult && <span className="ml-1 text-xs">({fixture.AwayTeamScore})</span>}
                      </button>
                    </td>
                    <td className="py-2 px-4 border border-slate-200 text-center text-slate-900">
                      {tips[fixture.MatchNumber]?.team || '-'}
                    </td>
                    <td className="py-2 px-4 border border-slate-200 text-center">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleDeadCertToggle(fixture.MatchNumber);
                        }}
                        type="button"
                        disabled={!isEditing || gameLocked || !tips[fixture.MatchNumber]?.team}
                        className={`px-3 py-1 rounded ${
                          tips[fixture.MatchNumber]?.deadCert
                            ? 'bg-yellow-500 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
                        } ${(!isEditing || gameLocked || !tips[fixture.MatchNumber]?.team) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {tips[fixture.MatchNumber]?.deadCert ? 'Yes' : 'No'}
                      </button>
                    </td>
                    <td className="py-2 px-4 border border-slate-200 text-center">
                      {isCorrectTip && <span className="text-emerald-600 font-bold text-lg">✓</span>}
                      {isWrongTip && <span className="text-red-600 font-bold text-lg">✗</span>}
                      {gameHasResult && winner === 'Draw' && <span className="text-slate-500 text-sm">Draw</span>}
                      {!gameHasResult && gameHasStarted && <span className="text-yellow-500 text-xs">Live</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </form>
        </div>
      )}

      {/* Admin note section when admin is selected */}
      {isAdmin && (
        <div className="mt-8 p-4 rounded-2xl bg-amber-50 border border-amber-200">
          <h3 className="text-lg font-semibold text-amber-800">Admin Override Enabled</h3>
          <p className="text-amber-700 mt-2">
            As an admin, you can edit tips for any user in any round, even if the round is locked.
            This allows you to make corrections or adjustments as needed.
          </p>
          <p className="text-amber-700 mt-2">
            Remember that changes made to locked rounds will be saved immediately and could affect scoring.
          </p>
          {currentTeamDisplayName && (
            <div className="mt-3 p-3 bg-white rounded-lg border border-amber-200">
              <p className="font-medium text-amber-800">Currently Editing:</p>
              <p className="text-amber-700">
                <span className="font-semibold">{currentTeamDisplayName}</span>'s tips for {formatRoundName(localRound)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
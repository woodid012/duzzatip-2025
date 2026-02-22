'use client';

import { useEffect, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { useUserContext } from '../layout';
import useTipping from '@/app/hooks/useTipping';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';
import { useToast } from '@/app/components/Toast';

export default function TippingPage() {
  // Get data from our app context
  const { currentRound, roundInfo } = useAppContext();
  
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
    isPastYear,
    formatRoundName,
    handleRoundChange,
    handleTipSelect,
    handleDeadCertToggle,
    saveTips,
    cancelEditing,
    startEditing,
    changeUser
  } = useTipping(selectedUserId === 'admin' ? '' : selectedUserId); // Only pass user if not admin

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
        <h2 className="text-2xl font-bold mb-4">Please Select a Player</h2>
        <p className="text-gray-600">
          Use the dropdown in the top right to select which player's tips you want to view or edit.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* MOBILE VIEW - Visible only on small screens */}
      <div className="block md:hidden">
        <MobileTippingView
          currentTeamDisplayName={currentTeamDisplayName}
          isAdmin={isAdmin}
          currentTeamBeingEdited={currentTeamBeingEdited}
          roundInfo={roundInfo}
          isRoundLocked={isRoundLocked}
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
          roundInfo={roundInfo}
          isRoundLocked={isRoundLocked}
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

// Mobile Component - Everything on one screen
function MobileTippingView({
  currentTeamDisplayName,
  isAdmin,
  currentTeamBeingEdited,
  roundInfo,
  isRoundLocked,
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
    <div className="p-3 space-y-4">
      {/* Compact Header */}
      <div className="bg-white rounded-lg p-3 shadow">
        <h1 className="text-lg font-bold text-black mb-2">
          {currentTeamDisplayName 
            ? `${currentTeamDisplayName}'s Tips${isAdmin ? ' (Admin)' : ''}` 
            : isAdmin 
              ? `AFL ${CURRENT_YEAR} Tips - Admin`
              : `AFL ${CURRENT_YEAR} Tips`}
        </h1>
        
        {/* Round Info */}
        <div className="text-xs space-y-1 mb-3">
          <div>
            {isRoundLocked && !isAdmin ? (
              <>
                <span className="text-red-600 font-medium">
                  {formatRoundName(localRound)} is locked 
                </span>
              </>
            ) : (
              <span className="text-green-600 font-medium">
                Showing {formatRoundName(localRound)}
                {isAdmin && isRoundLocked && (
                  <span className="ml-1 text-orange-500">(Admin Override)</span>
                )}
              </span>
            )}
          </div>
          
          {roundInfo.lockoutTime && (
            <div>
              <span className="text-gray-600">Lockout:</span>
              <span className="font-medium text-black ml-1">{roundInfo.lockoutTime}</span>
              {isRoundLocked && !isAdmin && (
                <span className="text-red-600 ml-1">(Locked)</span>
              )}
            </div>
          )}
          
          {lastEditedTime && currentTeamBeingEdited && (
            <div>
              <span className="text-gray-600">Last:</span>
              <span className="font-medium ml-1 text-gray-800">
                {formatDate(lastEditedTime)}
              </span>
            </div>
          )}
        </div>

        {/* Status Messages */}
        {successMessage && (
          <div className="bg-green-50 text-green-700 p-2 rounded text-xs mb-2">
            {successMessage}
          </div>
        )}
        {error && (
          <div className="bg-red-50 text-red-700 p-2 rounded text-xs mb-2">
            {error} — check your connection and try again.
          </div>
        )}

        {/* Action Buttons */}
        {currentTeamBeingEdited && !isPastYear && (
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={saveTips}
                  type="button"
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded text-sm font-medium"
                >
                  Save Tips
                </button>
                <button
                  onClick={cancelEditing}
                  type="button"
                  className="flex-1 bg-gray-500 hover:bg-gray-600 text-white px-3 py-2 rounded text-sm"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={handleEditClick}
                type="button"
                disabled={isRoundLocked && !isAdmin}
                className={`flex-1 px-3 py-2 rounded text-sm font-medium ${
                  isRoundLocked && !isAdmin
                    ? 'bg-gray-400 cursor-not-allowed text-white'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                {isRoundLocked && !isAdmin ? 'Locked' : 'Edit Tips'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg p-3 shadow space-y-3">
        {/* Round Selection */}
        <div>
          <label className="block text-xs font-medium text-black mb-1">Round:</label>
          <select 
            value={localRound}
            onChange={(e) => handleRoundChange(Number(e.target.value))}
            className="w-full border rounded p-2 text-sm text-black"
          >
            {[...Array(25)].map((_, i) => (
              <option key={i} value={i}>
                {formatRoundName(i)}
              </option>
            ))}
          </select>
        </div>

        {/* Admin Team Selection */}
        {isAdmin && (
          <div>
            <label className="block text-xs font-medium text-black mb-1">Team:</label>
            <select 
              value={hookSelectedUserId || ''}
              onChange={(e) => changeUser(e.target.value)}
              className="w-full border rounded p-2 text-sm text-black"
            >
              <option value="">
                {currentTeamDisplayName 
                  ? `Editing: ${currentTeamDisplayName}` 
                  : 'Select a team'}
              </option>
              {Object.entries(USER_NAMES).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Admin Message */}
      {isAdmin && !currentTeamBeingEdited && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <h3 className="text-blue-800 font-medium text-sm mb-1">Admin Mode</h3>
          <p className="text-blue-700 text-xs">
            Select a team from above to view and edit their tips.
          </p>
        </div>
      )}

      {/* Fixtures - Compact Cards */}
      {(currentTeamBeingEdited || !isAdmin) && roundFixtures.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-black">Match Tips</h2>
          <form onSubmit={handleFormSubmit}>
            {roundFixtures.map((fixture) => (
              <div key={fixture.MatchNumber} className="bg-white rounded-lg p-3 shadow">
                {/* Match Info */}
                <div className="text-xs text-gray-600 mb-2">
                  Game {fixture.MatchNumber} • {fixture.DateMelb}
                </div>
                
                {/* Team Selection */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleTipSelect(fixture.MatchNumber, fixture.HomeTeam);
                    }}
                    type="button"
                    disabled={!isEditing || (isRoundLocked && !isAdmin)}
                    className={`p-3 rounded-lg text-sm font-medium transition-colors ${
                      tips[fixture.MatchNumber]?.team === fixture.HomeTeam
                        ? 'bg-green-500 text-white shadow-md'
                        : 'bg-gray-100 hover:bg-gray-200 text-black'
                    } ${(!isEditing || (isRoundLocked && !isAdmin)) ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <div className="text-center">
                      <div className="font-bold">{fixture.HomeTeam}</div>
                      <div className="text-xs opacity-75">HOME</div>
                    </div>
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleTipSelect(fixture.MatchNumber, fixture.AwayTeam);
                    }}
                    type="button"
                    disabled={!isEditing || (isRoundLocked && !isAdmin)}
                    className={`p-3 rounded-lg text-sm font-medium transition-colors ${
                      tips[fixture.MatchNumber]?.team === fixture.AwayTeam
                        ? 'bg-green-500 text-white shadow-md'
                        : 'bg-gray-100 hover:bg-gray-200 text-black'
                    } ${(!isEditing || (isRoundLocked && !isAdmin)) ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <div className="text-center">
                      <div className="font-bold">{fixture.AwayTeam}</div>
                      <div className="text-xs opacity-75">AWAY</div>
                    </div>
                  </button>
                </div>
                
                {/* Tip Status & Dead Cert */}
                <div className="flex justify-between items-center">
                  <div className="text-xs">
                    <span className="text-gray-600">Your tip:</span>
                    <span className="font-medium ml-1 text-black">
                      {tips[fixture.MatchNumber]?.team || 'Not selected'}
                    </span>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleDeadCertToggle(fixture.MatchNumber);
                    }}
                    type="button"
                    disabled={!isEditing || (isRoundLocked && !isAdmin) || !tips[fixture.MatchNumber]?.team}
                    className={`px-3 py-1 rounded text-xs font-medium ${
                      tips[fixture.MatchNumber]?.deadCert
                        ? 'bg-yellow-500 text-white'
                        : 'bg-gray-100 text-black'
                    } ${(!isEditing || (isRoundLocked && !isAdmin) || !tips[fixture.MatchNumber]?.team) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-yellow-400'}`}
                  >
                    {tips[fixture.MatchNumber]?.deadCert ? '⭐ Dead Cert' : 'Dead Cert'}
                  </button>
                </div>
              </div>
            ))}
          </form>
        </div>
      )}

      {/* Admin Info */}
      {isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <h3 className="text-sm font-medium text-amber-800 mb-1">Admin Override</h3>
          <p className="text-amber-700 text-xs">
            You can edit tips for any user in any round, even if locked.
          </p>
          {currentTeamDisplayName && (
            <div className="mt-2 p-2 bg-white rounded border border-amber-200">
              <p className="text-xs font-medium text-amber-800">Currently Editing:</p>
              <p className="text-xs text-amber-700">
                <span className="font-medium">{currentTeamDisplayName}</span> • {formatRoundName(localRound)}
              </p>
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
      <div className="flex justify-between items-center mb-8">
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-black">
            {currentTeamDisplayName 
              ? `${currentTeamDisplayName}'s Tips${isAdmin ? ' (Admin Editing)' : ''}` 
              : isAdmin 
                ? `AFL ${CURRENT_YEAR} Tips - Admin Mode`
                : `AFL ${CURRENT_YEAR} Tips`}
          </h1>
          
          {/* Show round info */}
          <div className="flex flex-col gap-1 mt-1">
            <div className="text-sm font-medium">
              {isRoundLocked && !isAdmin ? (
                <>
                  <span className="text-red-600">
                    {formatRoundName(localRound)} is locked 
                  </span>
                  <span className="text-gray-600 ml-1">
                    - Showing {formatRoundName(localRound)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-green-600">
                    Showing {formatRoundName(localRound)}
                  </span>
                  {isAdmin && isRoundLocked && (
                    <span className="ml-2 text-orange-500 font-medium">
                      (Normally locked, admin override enabled)
                    </span>
                  )}
                </>
              )}
            </div>
            
            {roundInfo.lockoutTime && (
              <div className="text-sm">
                <span className="text-gray-600">Lockout:</span>
                <span className="font-medium text-black ml-1">{roundInfo.lockoutTime}</span>
                {isRoundLocked && !isAdmin && (
                  <span className="text-red-600 ml-1">(Locked)</span>
                )}
              </div>
            )}
            {lastEditedTime && currentTeamBeingEdited && (
              <div className="text-sm mt-1">
                <span className="text-gray-600">Last Submitted:</span>
                <span className="font-medium ml-1 text-gray-800">
                  {formatDate(lastEditedTime)}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {successMessage && (
            <span className="text-green-600">
              {successMessage}
            </span>
          )}
          {error && (
            <span className="text-red-600">
              {error}
            </span>
          )}
          {/* Only show edit buttons if we have a team selected and not viewing a past year */}
          {currentTeamBeingEdited && !isPastYear && (
            isEditing ? (
              <>
                <button
                  onClick={saveTips}
                  type="button"
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                >
                  Save Changes
                </button>
                <button
                  onClick={cancelEditing}
                  type="button"
                  className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
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
                {isRoundLocked && !isAdmin ? 'Locked' : 'Edit Tips'}
              </button>
            )
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="flex flex-col">
          <label className="mb-2 font-semibold text-black">Select Round:</label>
          <select 
            value={localRound}
            onChange={(e) => handleRoundChange(Number(e.target.value))}
            className="border rounded p-2 text-black"
          >
            {[...Array(25)].map((_, i) => (
              <option key={i} value={i}>
                {formatRoundName(i)}
              </option>
            ))}
          </select>
        </div>

        {isAdmin && (
          <div className="flex flex-col">
            <label className="mb-2 font-semibold text-black">Select Team:</label>
            <select 
              value={hookSelectedUserId || ''}
              onChange={(e) => {
                console.log(`Admin selecting team: ${e.target.value}`);
                changeUser(e.target.value);
              }}
              className="border rounded p-2 text-black"
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
          </div>
        )}
      </div>

      {/* Show message if admin but no team selected */}
      {isAdmin && !currentTeamBeingEdited && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="text-blue-800 font-semibold mb-2">Admin Mode</h3>
          <p className="text-blue-700">
            Select a team from the dropdown above to view and edit their tips.
          </p>
        </div>
      )}

      {/* Show fixtures table only if we have a team selected or it's not admin mode */}
      {(currentTeamBeingEdited || !isAdmin) && roundFixtures.length > 0 && (
        <div className="overflow-x-auto">
          <form onSubmit={handleFormSubmit}>
            <table className="min-w-full bg-white border">
              <thead>
                <tr className="bg-gray-100">
                  <th className="py-2 px-4 border text-black">Date</th>
                  <th className="py-2 px-4 border text-black">Home Team</th>
                  <th className="py-2 px-4 border text-black">Away Team</th>
                  <th className="py-2 px-4 border text-black">Your Tip</th>
                  <th className="py-2 px-4 border text-black">Dead Cert</th>
                </tr>
              </thead>
              <tbody className="text-black">
                {roundFixtures.map((fixture) => (
                  <tr key={fixture.MatchNumber} className="hover:bg-gray-50">
                    <td className="py-2 px-4 border text-black">{fixture.DateMelb}</td>
                    <td className="py-2 px-4 border">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleTipSelect(fixture.MatchNumber, fixture.HomeTeam);
                        }}
                        type="button"
                        disabled={!isEditing || (isRoundLocked && !isAdmin)}
                        className={`px-3 py-1 rounded ${
                          tips[fixture.MatchNumber]?.team === fixture.HomeTeam
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-100 hover:bg-gray-200 text-black'
                        } ${(!isEditing || (isRoundLocked && !isAdmin)) ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        {fixture.HomeTeam}
                      </button>
                    </td>
                    <td className="py-2 px-4 border">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleTipSelect(fixture.MatchNumber, fixture.AwayTeam);
                        }}
                        type="button"
                        disabled={!isEditing || (isRoundLocked && !isAdmin)}
                        className={`px-3 py-1 rounded ${
                          tips[fixture.MatchNumber]?.team === fixture.AwayTeam
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-100 hover:bg-gray-200 text-black'
                        } ${(!isEditing || (isRoundLocked && !isAdmin)) ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        {fixture.AwayTeam}
                      </button>
                    </td>
                    <td className="py-2 px-4 border text-center text-black">
                      {tips[fixture.MatchNumber]?.team || '-'}
                    </td>
                    <td className="py-2 px-4 border text-center">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          handleDeadCertToggle(fixture.MatchNumber);
                        }}
                        type="button"
                        disabled={!isEditing || (isRoundLocked && !isAdmin) || !tips[fixture.MatchNumber]?.team}
                        className={`px-3 py-1 rounded ${
                          tips[fixture.MatchNumber]?.deadCert
                            ? 'bg-yellow-500 text-white'
                            : 'bg-gray-100 hover:bg-gray-200 text-black'
                        } ${(!isEditing || (isRoundLocked && !isAdmin) || !tips[fixture.MatchNumber]?.team) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {tips[fixture.MatchNumber]?.deadCert ? 'Yes' : 'No'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </form>
        </div>
      )}

      {/* Admin note section when admin is selected */}
      {isAdmin && (
        <div className="mt-8 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <h3 className="text-lg font-semibold text-amber-800">Admin Override Enabled</h3>
          <p className="text-amber-700 mt-2">
            As an admin, you can edit tips for any user in any round, even if the round is locked.
            This allows you to make corrections or adjustments as needed.
          </p>
          <p className="text-amber-700 mt-2">
            Remember that changes made to locked rounds will be saved immediately and could affect scoring.
          </p>
          {currentTeamDisplayName && (
            <div className="mt-3 p-3 bg-white rounded border border-amber-200">
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
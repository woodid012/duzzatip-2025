'use client';

import { useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { useUserContext } from '../layout';
import useTipping from '@/app/hooks/useTipping';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';

export default function TippingPage() {
  // Get data from our app context
  const { currentRound, roundInfo, changeRound } = useAppContext();
  
  // Get selected user context
  const { selectedUserId } = useUserContext();
  
  // Get tipping functionality from our hook
  const {
    selectedUserId: hookSelectedUserId,
    tips,
    roundFixtures,
    isEditing,
    loading,
    error,
    successMessage,
    handleTipSelect,
    handleDeadCertToggle,
    saveTips,
    cancelEditing,
    startEditing,
    changeUser
  } = useTipping(selectedUserId); // Pass selected user from context

  // Sync the selected user from context to the hook
  useEffect(() => {
    if (selectedUserId) {
      changeUser(selectedUserId);
    }
  }, [selectedUserId, changeUser]);

  // Handle round change
  const handleRoundChange = (e) => {
    const newRound = Number(e.target.value);
    changeRound(newRound);
  };

  const displayRound = (round) => {
    return round === 0 ? 'Opening Round' : `Round ${round}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading fixtures...</div>
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
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-black">
            {selectedUserId && selectedUserId !== 'admin' 
              ? `${USER_NAMES[selectedUserId]}'s Tips` 
              : `AFL ${CURRENT_YEAR} Tips`}
          </h1>
          {roundInfo.lockoutTime && (
            <div className="text-sm mt-2">
              <span className="text-gray-600">Lockout:</span>
              <span className="font-medium text-black ml-1">{roundInfo.lockoutTime}</span>
              {roundInfo.isLocked && (
                <span className="text-red-600 ml-1">(Locked)</span>
              )}
            </div>
          )}
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
          {(selectedUserId || hookSelectedUserId) && (
            isEditing ? (
              <>
                <button 
                  onClick={saveTips}
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                >
                  Save Changes
                </button>
                <button 
                  onClick={cancelEditing}
                  className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button 
                onClick={startEditing}
                disabled={roundInfo.isLocked}
                className={`px-4 py-2 rounded ${
                  roundInfo.isLocked 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-blue-500 hover:bg-blue-600'
                } text-white`}
              >
                {roundInfo.isLocked ? 'Locked' : 'Edit Tips'}
              </button>
            )
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="flex flex-col">
          <label className="mb-2 font-semibold text-black">Select Round:</label>
          <select 
            value={currentRound}
            onChange={handleRoundChange}
            className="border rounded p-2 text-black"
          >
            {[...Array(25)].map((_, i) => (
              <option key={i} value={i}>
                {displayRound(i)}
              </option>
            ))}
          </select>
        </div>

        {selectedUserId === 'admin' && (
          <div className="flex flex-col">
            <label className="mb-2 font-semibold text-black">Select Team:</label>
            <select 
              value={hookSelectedUserId}
              onChange={(e) => changeUser(e.target.value)}
              className="border rounded p-2 text-black"
            >
              <option value="">Select a team</option>
              {Object.entries(USER_NAMES).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
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
                    onClick={() => handleTipSelect(fixture.MatchNumber, fixture.HomeTeam)}
                    disabled={!isEditing || roundInfo.isLocked}
                    className={`px-3 py-1 rounded ${
                      tips[fixture.MatchNumber]?.team === fixture.HomeTeam
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-black'
                    } ${(!isEditing || roundInfo.isLocked) ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    {fixture.HomeTeam}
                  </button>
                </td>
                <td className="py-2 px-4 border">
                  <button
                    onClick={() => handleTipSelect(fixture.MatchNumber, fixture.AwayTeam)}
                    disabled={!isEditing || roundInfo.isLocked}
                    className={`px-3 py-1 rounded ${
                      tips[fixture.MatchNumber]?.team === fixture.AwayTeam
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-black'
                    } ${(!isEditing || roundInfo.isLocked) ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    {fixture.AwayTeam}
                  </button>
                </td>
                <td className="py-2 px-4 border text-center text-black">
                  {tips[fixture.MatchNumber]?.team || '-'}
                </td>
                <td className="py-2 px-4 border text-center">
                  <button
                    onClick={() => handleDeadCertToggle(fixture.MatchNumber)}
                    disabled={!isEditing || roundInfo.isLocked || !tips[fixture.MatchNumber]?.team}
                    className={`px-3 py-1 rounded ${
                      tips[fixture.MatchNumber]?.deadCert
                        ? 'bg-yellow-500 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-black'
                    } ${(!isEditing || roundInfo.isLocked || !tips[fixture.MatchNumber]?.team) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {tips[fixture.MatchNumber]?.deadCert ? 'Yes' : 'No'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
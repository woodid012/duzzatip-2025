'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUserContext } from '../layout';
import { USER_NAMES } from '@/app/lib/constants';
import { ROUNDS_PER_DRAFT, USERS_PER_DRAFT, TOTAL_PICKS } from '@/app/lib/draft_constants';

// Color palette for 8 users
const USER_COLORS = {
  1: 'bg-red-100 border-red-300',
  2: 'bg-blue-100 border-blue-300',
  3: 'bg-green-100 border-green-300',
  4: 'bg-yellow-100 border-yellow-300',
  5: 'bg-purple-100 border-purple-300',
  6: 'bg-pink-100 border-pink-300',
  7: 'bg-orange-100 border-orange-300',
  8: 'bg-teal-100 border-teal-300',
};

const USER_HEADER_COLORS = {
  1: 'bg-red-200',
  2: 'bg-blue-200',
  3: 'bg-green-200',
  4: 'bg-yellow-200',
  5: 'bg-purple-200',
  6: 'bg-pink-200',
  7: 'bg-orange-200',
  8: 'bg-teal-200',
};

export default function DraftPage() {
  const { selectedUserId, isAdminAuthenticated } = useUserContext();

  const [draftState, setDraftState] = useState(null);
  const [players, setPlayers] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pick UI state
  const [teamFilter, setTeamFilter] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Admin edit state
  const [editingPick, setEditingPick] = useState(null);
  const [editPlayerName, setEditPlayerName] = useState('');
  const [editTeamName, setEditTeamName] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  // Fetch draft state
  const fetchDraftState = useCallback(async () => {
    try {
      const res = await fetch('/api/draft');
      if (!res.ok) throw new Error('Failed to fetch draft state');
      const data = await res.json();
      setDraftState(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching draft state:', err);
      setError('Failed to load draft data');
    }
  }, []);

  // Fetch players
  const fetchPlayers = useCallback(async () => {
    try {
      const res = await fetch('/api/players');
      if (!res.ok) throw new Error('Failed to fetch players');
      const data = await res.json();
      setPlayers(data);
    } catch (err) {
      console.error('Error fetching players:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    Promise.all([fetchDraftState(), fetchPlayers()]).then(() => setLoading(false));
  }, [fetchDraftState, fetchPlayers]);

  // Poll for updates every 3 seconds
  useEffect(() => {
    const interval = setInterval(fetchDraftState, 3000);
    return () => clearInterval(interval);
  }, [fetchDraftState]);

  // Get picked player names for filtering
  const pickedPlayerNames = new Set(
    (draftState?.picks || []).map(p => p.playerName.toLowerCase())
  );

  // Flatten all players and filter available ones
  const allPlayers = Object.entries(players).flatMap(([team, teamPlayers]) =>
    teamPlayers.map(p => ({ ...p, teamName: team }))
  );

  const availablePlayers = allPlayers.filter(
    p => !pickedPlayerNames.has(p.name.toLowerCase())
  );

  // Filter by team
  const filteredPlayers = availablePlayers
    .filter(p => !teamFilter || p.teamName === teamFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  const teams = Object.keys(players).sort();

  // Determine if it's current user's turn
  const isMyTurn =
    draftState?.status !== 'completed' &&
    draftState?.nextPick &&
    selectedUserId &&
    selectedUserId !== 'admin' &&
    draftState.nextPick.userId === parseInt(selectedUserId);

  const isAdmin = selectedUserId === 'admin' && isAdminAuthenticated;

  // Submit a pick
  const handleSubmitPick = async () => {
    if (!selectedPlayer || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: parseInt(selectedUserId),
          playerName: selectedPlayer.name,
          teamName: selectedPlayer.teamName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to submit pick');
      } else {
        setDraftState(data);
        setSelectedPlayer(null);
      }
    } catch (err) {
      alert('Failed to submit pick');
    } finally {
      setSubmitting(false);
    }
  };

  // Admin: delete pick and all subsequent
  const handleDeletePick = async (pickNumber) => {
    try {
      const res = await fetch('/api/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', pickNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to delete pick');
      } else {
        setDraftState(data);
        setShowDeleteConfirm(null);
      }
    } catch (err) {
      alert('Failed to delete pick');
    }
  };

  // Admin: edit pick
  const handleEditPick = async () => {
    if (!editingPick || !editPlayerName || !editTeamName) return;
    try {
      const res = await fetch('/api/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          pickNumber: editingPick.pickNumber,
          playerName: editPlayerName,
          teamName: editTeamName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to edit pick');
      } else {
        setDraftState(data);
        setEditingPick(null);
        setEditPlayerName('');
        setEditTeamName('');
      }
    } catch (err) {
      alert('Failed to edit pick');
    }
  };

  // Admin: reset draft
  const handleResetDraft = async () => {
    try {
      const res = await fetch('/api/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to reset draft');
      } else {
        setDraftState(data);
        setShowResetConfirm(false);
      }
    } catch (err) {
      alert('Failed to reset draft');
    }
  };

  // Build the draft board grid data
  // Columns are ordered by DRAFT_ORDER, rows are rounds
  const buildBoardData = () => {
    if (!draftState) return [];
    const pickMap = {};
    draftState.picks.forEach(p => {
      pickMap[p.pickNumber] = p;
    });

    const board = [];
    const pickOrder = draftState.pickOrder || [];
    for (let round = 1; round <= ROUNDS_PER_DRAFT; round++) {
      const row = {};
      // Get the picks for this round in column order
      const roundPicks = pickOrder.filter(p => p.round === round);
      roundPicks.forEach(rp => {
        row[rp.userId] = {
          pickNumber: rp.pickNumber,
          pick: pickMap[rp.pickNumber] || null,
          isNext: rp.pickNumber === draftState.nextPickNumber,
        };
      });
      board.push({ round, picks: row });
    }
    return board;
  };

  const boardData = buildBoardData();

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-center text-gray-500">Loading draft...</div>
      </div>
    );
  }

  if (error && !draftState) {
    return (
      <div className="p-4">
        <div className="text-center text-red-500">{error}</div>
      </div>
    );
  }

  const currentRound = draftState?.nextPick?.round || (draftState?.status === 'completed' ? ROUNDS_PER_DRAFT : 1);
  const currentPickUser = draftState?.nextPick ? USER_NAMES[draftState.nextPick.userId] : null;

  return (
    <div className="p-2 md:p-4 space-y-4">
      {/* Status Banner */}
      <div className="bg-gray-800 text-white rounded-lg p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg md:text-xl font-bold">Player Draft</h1>
            <div className="text-sm text-gray-300">
              {draftState?.status === 'not_started' && 'Draft has not started yet'}
              {draftState?.status === 'in_progress' && (
                <>
                  Round {currentRound} of {ROUNDS_PER_DRAFT} — Pick #{draftState.nextPickNumber} of {TOTAL_PICKS}
                </>
              )}
              {draftState?.status === 'completed' && 'Draft Complete!'}
            </div>
          </div>
          {draftState?.status !== 'completed' && currentPickUser && (
            <div className="text-right">
              <div className="text-xs text-gray-400">On the clock</div>
              <div className="text-sm md:text-base font-semibold text-green-400">{currentPickUser}</div>
            </div>
          )}
        </div>
      </div>

      {/* Pick UI — shown when it's the user's turn */}
      {isMyTurn && (
        <div className="bg-green-50 border-2 border-green-400 rounded-lg p-3 md:p-4">
          <h2 className="text-base font-bold text-green-800 mb-2">
            Your pick! (#{draftState.nextPickNumber})
          </h2>
          <div className="flex flex-col md:flex-row gap-2 mb-3">
            {/* Team filter */}
            <select
              value={teamFilter}
              onChange={e => { setTeamFilter(e.target.value); setSelectedPlayer(null); }}
              className="p-2 border rounded text-sm text-black bg-white md:w-48"
            >
              <option value="">All Teams</option>
              {teams.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            {/* Player dropdown */}
            <select
              value={selectedPlayer ? `${selectedPlayer.name}||${selectedPlayer.teamName}` : ''}
              onChange={e => {
                if (!e.target.value) { setSelectedPlayer(null); return; }
                const [name, team] = e.target.value.split('||');
                const player = filteredPlayers.find(p => p.name === name && p.teamName === team);
                setSelectedPlayer(player || null);
              }}
              className="p-2 border rounded text-sm text-black bg-white flex-1"
            >
              <option value="">Select a player...</option>
              {filteredPlayers.map(p => (
                <option key={p.id || `${p.name}-${p.teamName}`} value={`${p.name}||${p.teamName}`}>
                  {p.name} ({p.teamName})
                </option>
              ))}
            </select>

            {/* Submit button */}
            <button
              onClick={handleSubmitPick}
              disabled={!selectedPlayer || submitting}
              className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed md:w-32"
            >
              {submitting ? 'Submitting...' : 'Submit Pick'}
            </button>
          </div>
        </div>
      )}

      {/* Admin Controls */}
      {isAdmin && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-amber-800">Admin Controls</h3>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
            >
              Reset Draft
            </button>
          </div>
          <p className="text-xs text-amber-700 mt-1">Click any pick on the board to edit or delete it.</p>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-2">Reset Draft?</h3>
            <p className="text-sm text-gray-600 mb-4">This will delete ALL picks. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleResetDraft}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold mb-2">Delete Pick #{showDeleteConfirm}?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will also delete all picks after #{showDeleteConfirm}, since they may have been influenced by this pick.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeletePick(showDeleteConfirm)}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Pick Modal */}
      {editingPick && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-2">Edit Pick #{editingPick.pickNumber}</h3>
            <p className="text-sm text-gray-600 mb-3">
              Current: {editingPick.playerName} ({editingPick.teamName})
            </p>
            <div className="space-y-2 mb-4">
              <select
                value={editTeamName}
                onChange={e => setEditTeamName(e.target.value)}
                className="w-full p-2 border rounded text-sm text-black bg-white"
              >
                <option value="">Select Team</option>
                {teams.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select
                value={editPlayerName}
                onChange={e => setEditPlayerName(e.target.value)}
                className="w-full p-2 border rounded text-sm text-black bg-white"
              >
                <option value="">Select Player</option>
                {(editTeamName ? (players[editTeamName] || []) : allPlayers)
                  .filter(p => !pickedPlayerNames.has(p.name.toLowerCase()) || p.name === editingPick.playerName)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(p => (
                    <option key={p.id || p.name} value={p.name}>
                      {p.name} {!editTeamName ? `(${p.teamName})` : ''}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditingPick(null);
                  setEditPlayerName('');
                  setEditTeamName('');
                }}
                className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleEditPick}
                disabled={!editPlayerName || !editTeamName}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draft Board */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs md:text-sm border-collapse min-w-[700px]">
          <thead>
            <tr>
              <th className="p-1 md:p-2 bg-gray-100 border text-left w-12">Rd</th>
              {(draftState?.draftOrder || []).map(userId => (
                <th
                  key={userId}
                  className={`p-1 md:p-2 border text-center ${USER_HEADER_COLORS[userId]}`}
                >
                  <div className="truncate text-xs" title={USER_NAMES[userId]}>
                    {USER_NAMES[userId]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {boardData.map(row => (
              <tr key={row.round}>
                <td className="p-1 md:p-2 bg-gray-50 border font-medium text-center">
                  {row.round}
                </td>
                {(draftState?.draftOrder || []).map(userId => {
                  const cell = row.picks[userId];
                  if (!cell) return <td key={userId} className="border p-1" />;

                  const pick = cell.pick;
                  const isNext = cell.isNext;
                  const cellClass = pick
                    ? `${USER_COLORS[userId]} border`
                    : isNext
                    ? 'bg-green-200 border-2 border-green-500 animate-pulse'
                    : 'bg-white border';

                  return (
                    <td
                      key={userId}
                      className={`p-1 md:p-2 ${cellClass} ${isAdmin && pick ? 'cursor-pointer hover:opacity-75' : ''}`}
                      onClick={() => {
                        if (isAdmin && pick) {
                          setEditingPick(pick);
                          setEditPlayerName(pick.playerName);
                          setEditTeamName(pick.teamName);
                        }
                      }}
                      onContextMenu={e => {
                        if (isAdmin && pick) {
                          e.preventDefault();
                          setShowDeleteConfirm(pick.pickNumber);
                        }
                      }}
                    >
                      {pick ? (
                        <div>
                          <div className="font-medium truncate" title={pick.playerName}>
                            {pick.playerName}
                          </div>
                          <div className="text-gray-500 text-xs truncate">{pick.teamName}</div>
                        </div>
                      ) : isNext ? (
                        <div className="text-center text-green-700 font-medium text-xs">
                          #{cell.pickNumber}
                        </div>
                      ) : (
                        <div className="text-center text-gray-300 text-xs">
                          #{cell.pickNumber}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <p className="text-xs text-gray-500">
          Admin: Click a pick to edit. Right-click a pick to delete it and all subsequent picks.
        </p>
      )}

      {/* Recent Picks */}
      {draftState?.picks?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold mb-2">Recent Picks</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {[...draftState.picks].reverse().slice(0, 20).map(pick => (
              <div
                key={pick.pickNumber}
                className={`flex items-center gap-2 text-xs p-1 rounded ${USER_COLORS[pick.userId]}`}
              >
                <span className="font-mono w-8 text-right">#{pick.pickNumber}</span>
                <span className="font-medium">{pick.playerName}</span>
                <span className="text-gray-500">({pick.teamName})</span>
                <span className="text-gray-400 ml-auto">{USER_NAMES[pick.userId]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Players count */}
      <div className="text-xs text-gray-500 mt-2">
        {availablePlayers.length} players available — {draftState?.picks?.length || 0} / {TOTAL_PICKS} picks made
      </div>
    </div>
  );
}

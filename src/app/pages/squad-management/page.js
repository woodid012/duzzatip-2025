'use client';

import React, { useState, useEffect } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { useUserContext } from '../layout';
import { USER_NAMES } from '@/app/lib/constants';
import { User, ArrowRightLeft, UserPlus, UserMinus, Calendar, Edit, X, Save, RefreshCw } from 'lucide-react';

export default function SquadManagementPage() {
  const { selectedYear, isPastYear } = useAppContext();
  const { selectedUserId } = useUserContext();
  const [isEditing, setIsEditing] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [transactionType, setTransactionType] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerTeam, setNewPlayerTeam] = useState('');
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tradeWithUserId, setTradeWithUserId] = useState('');
  const [allUserSquads, setAllUserSquads] = useState({});

  // Initialize squadData with empty structure
  const [squadData, setSquadData] = useState({
    currentSquad: [],
    transactions: []
  });

  // Function to reload squad data after changes
  const reloadSquadData = async () => {
    if (!selectedUserId) return;
    
    try {
      // Get updated squad data
      const squadRes = await fetch(`/api/squads?year=${selectedYear}`);
      if (!squadRes.ok) throw new Error('Failed to fetch updated squad');
      const squadData = await squadRes.json();
      
      // Get updated history
      let transactions = [];
      try {
        const historyRes = await fetch(`/api/squads?userId=${selectedUserId}`, {
          method: 'OPTIONS'
        });
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          transactions = historyData.transactions || [];
        }
      } catch (historyError) {
        console.warn('Squad history not available:', historyError);
      }
      
      // Process squad data
      const userSquad = squadData[selectedUserId];
      if (userSquad && userSquad.players) {
        console.log("Reloaded squad data:", userSquad.players);
        setSquadData({
          currentSquad: userSquad.players.map(player => ({
            name: player.name,
            team: player.team,
            acquisition_type: player.acquisition_type || 'initial',
            acquisition_date: player.acquisition_date || new Date().toISOString()
          })),
          transactions: transactions
        });
      }
      
      // Update all user squads for trading
      setAllUserSquads(squadData);
      
    } catch (err) {
      console.error('Error reloading squad data:', err);
    }
  };

  // Fetch squad data including acquisition history
  useEffect(() => {
    const fetchSquadData = async () => {
      if (!selectedUserId) return;
      
      try {
        setLoading(true);
        
        // Get all squads
        const squadRes = await fetch(`/api/squads?year=${selectedYear}`);
        if (!squadRes.ok) throw new Error('Failed to fetch squad');
        const squadData = await squadRes.json();
        
        // Store all squads for trading purposes
        setAllUserSquads(squadData);
        
        // Get squad history (if you've implemented this endpoint)
        let transactions = [];
        try {
          const historyRes = await fetch(`/api/squads?userId=${selectedUserId}`, {
            method: 'OPTIONS'
          });
          if (historyRes.ok) {
            const historyData = await historyRes.json();
            transactions = historyData.transactions || [];
          }
        } catch (historyError) {
          console.warn('Squad history not available:', historyError);
        }
        
        // Process squad data
        const userSquad = squadData[selectedUserId];
        if (userSquad && userSquad.players) {
          console.log("Received squad data:", userSquad.players);
          setSquadData({
            currentSquad: userSquad.players.map(player => ({
              name: player.name,
              team: player.team,
              acquisition_type: player.acquisition_type || 'initial',
              acquisition_date: player.acquisition_date || new Date().toISOString()
            })),
            transactions: transactions
          });
        } else {
          console.log("No players found for user, setting empty squad");
          setSquadData({
            currentSquad: [],
            transactions: transactions
          });
        }
        
        // Fetch available players
        const playersRes = await fetch(`/api/players?year=${selectedYear}`);
        if (!playersRes.ok) throw new Error('Failed to fetch players');
        const playersData = await playersRes.json();
        
        // Flatten the players from all teams and sort alphabetically
        const allPlayers = Object.values(playersData).flat();
        allPlayers.sort((a, b) => a.name.localeCompare(b.name));
        setAvailablePlayers(allPlayers);
        
      } catch (err) {
        console.error('Error fetching squad data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSquadData();
  }, [selectedUserId, selectedYear]);

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const getAcquisitionTypeInfo = (type) => {
    switch (type) {
      case 'initial':
        return { color: 'bg-blue-100 text-blue-800', icon: User, label: 'Initial Draft' };
      case 'midseason_draft_1':
        return { color: 'bg-green-100 text-green-800', icon: UserPlus, label: 'Mid-Season Draft 1' };
      case 'midseason_draft_2':
        return { color: 'bg-purple-100 text-purple-800', icon: UserPlus, label: 'Mid-Season Draft 2' };
      case 'trade':
        return { color: 'bg-orange-100 text-orange-800', icon: ArrowRightLeft, label: 'Trade' };
      case 'delist':
        return { color: 'bg-red-100 text-red-800', icon: UserMinus, label: 'Delisted' };
      default:
        return { color: 'bg-gray-100 text-gray-800', icon: User, label: type };
    }
  };

  const handleDelistPlayer = (player) => {
    // Select player for deletion confirmation UI
    setEditingPlayer(player);
    setTransactionType('delist');
    setNewPlayerName('');
    setNewPlayerTeam('');
    setTradeWithUserId('');
  };
  
  const handleTradePlayer = (player) => {
    setEditingPlayer(player);
    setTransactionType('trade');
    setNewPlayerName('');
    setNewPlayerTeam('');
    setTradeWithUserId('');
  };

  const handleSaveTransaction = async (forcedType = null) => {
    const transType = forcedType || transactionType;
    
    if (!editingPlayer || !transType) return;

    try {
      // If delisting, ask for confirmation
      if (transType === 'delist') {
        if (!window.confirm(`Are you sure you want to delist ${editingPlayer.name}?`)) {
          // Reset editing state if user cancels
          setEditingPlayer(null);
          setTransactionType('');
          return;
        }
        
        // Create new transaction for delist
        const newTransaction = {
          type: 'delist',
          date: new Date().toISOString().split('T')[0],
          players_in: [],
          players_out: [editingPlayer.name]
        };

        // Update current squad (remove player)
        const updatedSquad = squadData.currentSquad.filter(p => p.name !== editingPlayer.name);

        // Send to API
        const response = await fetch('/api/squads', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: selectedUserId,
            type: 'delist',
            players_in: [],
            players_out: [{name: editingPlayer.name, team: editingPlayer.team}]
          })
        });

        if (!response.ok) throw new Error('Failed to delist player');

        // Update state
        setSquadData({
          currentSquad: updatedSquad,
          transactions: [...squadData.transactions, newTransaction]
        });

        // Reset editing state
        setEditingPlayer(null);
        setTransactionType('');
        
        // Reload squad data to ensure consistency
        setTimeout(() => {
          reloadSquadData();
        }, 500);
        
        return;
      }

      // For trading, we need both players selected
      if (transType === 'trade') {
        if (!tradeWithUserId || !newPlayerName) {
          return; // Don't proceed if trade info is incomplete
        }
      
        // Create new transaction
        const newTransaction = {
          type: 'trade',
          date: new Date().toISOString().split('T')[0],
          players_in: [newPlayerName],
          players_out: [editingPlayer.name],
          tradeWithUser: USER_NAMES[tradeWithUserId]
        };

        // Update current squad
        const updatedSquad = squadData.currentSquad.filter(p => p.name !== editingPlayer.name);
        
        // Add new player from trade
        updatedSquad.push({
          name: newPlayerName,
          team: newPlayerTeam,
          acquisition_type: 'trade',
          acquisition_date: new Date().toISOString().split('T')[0]
        });

        // Send to API - update both teams
        const response = await fetch('/api/squads', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: selectedUserId,
            type: 'trade',
            players_in: [{name: newPlayerName, team: newPlayerTeam}],
            players_out: [{name: editingPlayer.name, team: editingPlayer.team}],
            tradeWithUserId: tradeWithUserId
          })
        });

        if (!response.ok) throw new Error('Failed to save trade for current user');
        
        // Update for the trade partner - reversed players in/out
        const partnerResponse = await fetch('/api/squads', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: tradeWithUserId,
            type: 'trade',
            players_in: [{name: editingPlayer.name, team: editingPlayer.team}],
            players_out: [{name: newPlayerName, team: newPlayerTeam}],
            tradeWithUserId: selectedUserId
          })
        });

        if (!partnerResponse.ok) throw new Error('Failed to save trade for partner user');

        // Update state
        setSquadData({
          currentSquad: updatedSquad,
          transactions: [...squadData.transactions, newTransaction]
        });
        
        // Reload squad data to ensure consistency
        setTimeout(() => {
          reloadSquadData();
        }, 500);
      }

      // Reset editing state
      setEditingPlayer(null);
      setTransactionType('');
      setNewPlayerName('');
      setNewPlayerTeam('');
      setTradeWithUserId('');
    } catch (err) {
      console.error('Error saving transaction:', err);
      setError(err.message);
    }
  };

  const handleSaveDraft = async () => {
    if (!transactionType || !newPlayerName) return;

    try {
      console.log(`Saving draft: ${transactionType} - ${newPlayerName}`);
      
      // Create transaction type - could be initial, midseason_draft_1, or midseason_draft_2
      const draftType = transactionType;
      
      // Create new transaction for draft
      const newTransaction = {
        type: draftType,
        date: new Date().toISOString().split('T')[0],
        players_in: [newPlayerName],
        players_out: []
      };

      // Add new player to squad
      const updatedSquad = [...squadData.currentSquad, {
        name: newPlayerName,
        team: newPlayerTeam,
        acquisition_type: draftType,
        acquisition_date: new Date().toISOString().split('T')[0]
      }];

      // Send to API
      const response = await fetch('/api/squads', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: selectedUserId,
          type: draftType,
          players_in: [{name: newPlayerName, team: newPlayerTeam}],
          players_out: []
        })
      });

      if (!response.ok) throw new Error(`Failed to save ${draftType === 'initial' ? 'initial draft' : 'draft'}`);

      // Immediately update the local state to show the new player
      setSquadData(prevData => ({
        currentSquad: [...prevData.currentSquad, {
          name: newPlayerName,
          team: newPlayerTeam,
          acquisition_type: draftType,
          acquisition_date: new Date().toISOString().split('T')[0]
        }],
        transactions: [...prevData.transactions, newTransaction]
      }));

      // Reload squad data to ensure consistency
      setTimeout(() => {
        reloadSquadData();
      }, 500);

      // Reset form fields but keep transaction type
      setNewPlayerName('');
      setNewPlayerTeam('');
      
      // Log the updated squad for debugging
      console.log("Updated squad after draft:", updatedSquad);
      
      // Don't reset transaction type for initial draft to allow for multiple selections
      if (draftType !== 'initial') {
        setTransactionType('');
      }
    } catch (err) {
      console.error('Error saving draft:', err);
      setError('Failed to save changes');
    }
  };

  const handlePlayerSelect = (player) => {
    setNewPlayerName(player.name);
    setNewPlayerTeam(player.teamName || player.team);
  };

  if (loading) return <div className="p-4">Loading squad data...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;
  
  if (!selectedUserId) {
    return (
      <div className="text-center p-10">
        <h2 className="text-2xl font-bold mb-4">Please Select a Player</h2>
        <p className="text-gray-600">
          Use the dropdown in the top right to select which player's squad you want to manage.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-2xl font-bold">{USER_NAMES[selectedUserId]} - Squad</h1>
        {!isPastYear && (
          <div className="flex gap-2">
            {isEditing && (
              <button
                onClick={() => {
                  setIsEditing(!isEditing);
                  setEditingPlayer(null);
                  setTransactionType('');
                  setNewPlayerName('');
                  setNewPlayerTeam('');
                }}
                className="px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 bg-red-500 text-white"
              >
                <X className="h-4 w-4" />
                Done
              </button>
            )}
            {!isEditing && (
              <button
                onClick={() => {
                  setIsEditing(true);
                  setEditingPlayer(null);
                  setTransactionType('');
                  setNewPlayerName('');
                  setNewPlayerTeam('');
                }}
                className="px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 bg-blue-500 text-white"
              >
                <Edit className="h-4 w-4" />
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {/* Draft & Trade Action Buttons - Now positioned at the top left */}
      {isEditing && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => {
              setEditingPlayer(null);
              setTransactionType('initial');
              setNewPlayerName('');
              setNewPlayerTeam('');
            }}
            className="px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 bg-blue-500 text-white"
          >
            <User className="h-4 w-4" />
            Initial Draft
          </button>
          <button
            onClick={() => {
              setEditingPlayer(null);
              setTransactionType('midseason_draft_1');
              setNewPlayerName('');
              setNewPlayerTeam('');
            }}
            className="px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 bg-green-500 text-white"
          >
            <UserPlus className="h-4 w-4" />
            Mid Draft 1
          </button>
          <button
            onClick={() => {
              setEditingPlayer(null);
              setTransactionType('midseason_draft_2');
              setNewPlayerName('');
              setNewPlayerTeam('');
            }}
            className="px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 bg-purple-500 text-white"
          >
            <UserPlus className="h-4 w-4" />
            Mid Draft 2
          </button>
          <button
            onClick={() => {
              setEditingPlayer(null);
              setTransactionType('trade');
              setNewPlayerName('');
              setNewPlayerTeam('');
            }}
            className="px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 bg-orange-500 text-white"
          >
            <ArrowRightLeft className="h-4 w-4" />
            Trade
          </button>
        </div>
      )}
      
      {/* Trade selection mode message */}
      {isEditing && transactionType === 'trade' && !editingPlayer && (
        <div className="bg-orange-50 p-3 rounded-lg border border-orange-200 mb-4">
          <p className="flex items-center gap-2 text-orange-800">
            <ArrowRightLeft className="h-5 w-5 text-orange-500" />
            Press the <RefreshCw className="h-4 w-4 inline text-orange-700" /> button on the player you wish to trade
          </p>
        </div>
      )}

      {/* Draft Form - Moved above squad */}
      {isEditing && !editingPlayer && (transactionType === 'initial' || transactionType === 'midseason_draft_1' || transactionType === 'midseason_draft_2') && (
        <div className="bg-gray-50 rounded-lg shadow p-4 mb-4">
          <h2 className="text-lg font-semibold mb-2">
            {transactionType === 'initial' ? 'Initial Draft' : 
             transactionType === 'midseason_draft_1' ? 'Mid-Season Draft 1' :
             transactionType === 'midseason_draft_2' ? 'Mid-Season Draft 2' : 'Draft Player'}
          </h2>
          
          <div className="flex flex-col sm:flex-row gap-2 items-end">
            <div className="w-full sm:w-1/2">
              <label className="block text-sm font-medium mb-1">
                {transactionType === 'initial' ? 'Select Player:' : 
                 transactionType === 'midseason_draft_1' ? 'Select Player (Mid Draft 1):' :
                 transactionType === 'midseason_draft_2' ? 'Select Player (Mid Draft 2):' : 'Select Player:'}
              </label>
              <select
                value={newPlayerName}
                onChange={(e) => {
                  const selectedPlayer = availablePlayers.find(p => p.name === e.target.value);
                  if (selectedPlayer) {
                    setNewPlayerName(selectedPlayer.name);
                    setNewPlayerTeam(selectedPlayer.teamName || selectedPlayer.team);
                  }
                }}
                className="w-full p-2 text-sm border rounded"
              >
                <option value="">Select a player</option>
                {availablePlayers.map((player, index) => (
                  <option key={index} value={player.name}>
                    {player.name} ({player.teamName || player.team})
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex gap-2 mt-2 sm:mt-0">
              <button
                onClick={() => {
                  setTransactionType('');
                  setNewPlayerName('');
                  setNewPlayerTeam('');
                }}
                className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDraft}
                disabled={!transactionType || !newPlayerName}
                className={`px-3 py-1.5 text-sm rounded flex items-center gap-1 ${
                  transactionType && newPlayerName
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <Save className="h-4 w-4" />
                Draft
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delist Player Confirmation UI */}
      {editingPlayer && transactionType === 'delist' && (
        <div className="bg-red-50 rounded-lg shadow p-4 mb-4 border border-red-200">
          <h2 className="text-lg font-semibold mb-2 text-red-800">Confirm Player Delisting</h2>
          <div className="mb-3 p-3 bg-white rounded border border-red-200">
            <div className="flex items-center gap-2">
              <UserMinus className="h-5 w-5 text-red-600" />
              <div>
                <p className="font-semibold text-red-800">{editingPlayer.name}</p>
                <p className="text-sm text-gray-600">{editingPlayer.team}</p>
              </div>
            </div>
          </div>
          
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setEditingPlayer(null);
                setTransactionType('');
              }}
              className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSaveTransaction('delist')}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1"
            >
              <UserMinus className="h-4 w-4" />
              Confirm Delist
            </button>
          </div>
        </div>
      )}
      
      {/* Trade Player Form - Moved above squad */}
      {editingPlayer && transactionType === 'trade' && (
        <div className="bg-gray-50 rounded-lg shadow p-4 mb-4">
          <h2 className="text-lg font-semibold mb-2">Trade Player</h2>
          <div className="mb-2 text-sm">
            <span className="text-gray-600">Trading:</span>
            <span className="font-semibold ml-1">{editingPlayer.name}</span> ({editingPlayer.team})
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-1/3">
              <label className="block text-sm font-medium mb-1">Trade With:</label>
              <select
                value={tradeWithUserId}
                onChange={(e) => {
                  setTradeWithUserId(e.target.value);
                  setNewPlayerName('');
                  setNewPlayerTeam('');
                }}
                className="w-full p-2 text-sm border rounded"
              >
                <option value="">Select Team</option>
                {Object.keys(allUserSquads)
                  .filter(userId => userId !== selectedUserId)
                  .map(userId => (
                    <option key={userId} value={userId}>
                      {USER_NAMES[userId] || `User ${userId}`}
                    </option>
                  ))}
              </select>
            </div>
            
            {tradeWithUserId && (
              <div className="w-full sm:w-1/3">
                <label className="block text-sm font-medium mb-1">Receive Player:</label>
                <select
                  value={newPlayerName}
                  onChange={(e) => {
                    const squad = allUserSquads[tradeWithUserId];
                    const selectedPlayer = squad?.players.find(p => p.name === e.target.value);
                    if (selectedPlayer) {
                      setNewPlayerName(selectedPlayer.name);
                      setNewPlayerTeam(selectedPlayer.team);
                    }
                  }}
                  className="w-full p-2 text-sm border rounded"
                >
                  <option value="">Select Player</option>
                  {allUserSquads[tradeWithUserId]?.players
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((player, index) => (
                      <option key={index} value={player.name}>
                        {player.name} ({player.team})
                      </option>
                    ))}
                </select>
              </div>
            )}
            
            <div className="flex items-end gap-2 mt-auto">
              <button
                onClick={() => setEditingPlayer(null)}
                className="px-3 py-1.5 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveTransaction()}
                disabled={!tradeWithUserId || !newPlayerName}
                className={`px-3 py-1.5 text-sm rounded flex items-center gap-1 ${
                  tradeWithUserId && newPlayerName
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <Save className="h-4 w-4" />
                Trade
              </button>
            </div>
          </div>
          
          {tradeWithUserId && newPlayerName && (
            <div className="mt-3 p-2 bg-gray-100 rounded-lg text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">You Send:</p>
                  <p>{editingPlayer.name} ({editingPlayer.team})</p>
                </div>
                <div className="text-gray-500">↔️</div>
                <div>
                  <p className="font-medium">You Receive:</p>
                  <p>{newPlayerName} ({newPlayerTeam})</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Current Squad with Color Coding - Made more compact */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="text-lg font-semibold mb-2">Current Squad</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {squadData.currentSquad.map((player, index) => {
            const typeInfo = getAcquisitionTypeInfo(player.acquisition_type);
            return (
              <div 
                key={index} 
                className={`p-2 rounded-lg ${typeInfo.color} ${
                  editingPlayer?.name === player.name ? 'ring-1 ring-blue-500' : ''
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex-1 truncate">
                    <p className="font-medium text-sm truncate">{player.name}</p>
                    <p className="text-xs truncate">{player.team}</p>
                  </div>
                  {isEditing && (
                    <div className="flex gap-1 ml-1 flex-shrink-0">
                      <button
                        onClick={() => handleTradePlayer(player)}
                        className="bg-orange-600 text-white p-1 rounded hover:bg-orange-700"
                        title="Trade player"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleDelistPlayer(player)}
                        className="bg-red-600 text-white p-1 rounded hover:bg-red-700"
                        title="Delist player"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Legend */}
        <div className="mt-3 pt-2 border-t border-gray-200">
          <div className="flex flex-wrap gap-2 text-xs">
            {['initial', 'midseason_draft_1', 'midseason_draft_2', 'trade'].map((type) => {
              const typeInfo = getAcquisitionTypeInfo(type);
              return (
                <div key={type} className={`px-2 py-1 rounded ${typeInfo.color}`}>
                  {typeInfo.label}
                </div>
              );
            })}
          </div>
        </div>
      </div>



      {/* Squad History - More compact */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Squad History</h2>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {/* Display transactions */}
          {squadData.transactions.map((transaction, index) => {
            const typeInfo = getAcquisitionTypeInfo(transaction.type);
            return (
              <div key={index} className="border-l-2 border-gray-200 pl-3 py-1">
                <div className="flex items-center gap-1 text-xs">
                  <Calendar className="h-3 w-3 text-gray-500" />
                  <span className="font-medium">{formatDate(transaction.date)}</span>
                  <span className={`px-1.5 py-0.5 rounded ${typeInfo.color}`}>
                    {typeInfo.label}
                  </span>
                  {transaction.tradeWithUser && (
                    <span className="text-gray-600">
                      with {transaction.tradeWithUser}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-xs mt-1">
                  {transaction.players_in?.length > 0 && (
                    <div className="flex-1">
                      <span className="font-medium text-green-700">In:</span>
                      <span className="text-green-600 ml-1">
                        {transaction.players_in.join(', ')}
                      </span>
                    </div>
                  )}
                  {transaction.players_out?.length > 0 && (
                    <div className="flex-1">
                      <span className="font-medium text-red-700">Out:</span>
                      <span className="text-red-600 ml-1">
                        {transaction.players_out.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
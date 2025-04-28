// src/app/pages/squad-management/page.js
'use client';

import React, { useState, useEffect } from 'react';
import { useUserContext } from '../layout';
import { USER_NAMES } from '@/app/lib/constants';
import { User, ArrowRightLeft, UserPlus, UserMinus, Calendar, Edit, X, Save } from 'lucide-react';

export default function SquadManagementPage() {
  const { selectedUserId } = useUserContext();
  const [isEditing, setIsEditing] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [transactionType, setTransactionType] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerTeam, setNewPlayerTeam] = useState('');
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize squadData with empty structure
  const [squadData, setSquadData] = useState({
    currentSquad: [],
    transactions: []
  });

  // Fetch squad data including acquisition history
  useEffect(() => {
    const fetchSquadData = async () => {
      if (!selectedUserId) return;
      
      try {
        setLoading(true);
        
        // Get current squad
        const squadRes = await fetch('/api/squads');
        if (!squadRes.ok) throw new Error('Failed to fetch squad');
        const squadData = await squadRes.json();
        
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
        
        // Fetch available players
        const playersRes = await fetch('/api/players');
        if (!playersRes.ok) throw new Error('Failed to fetch players');
        const playersData = await playersRes.json();
        
        // Flatten the players from all teams
        const allPlayers = Object.values(playersData).flat();
        setAvailablePlayers(allPlayers);
        
      } catch (err) {
        console.error('Error fetching squad data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSquadData();
  }, [selectedUserId]);

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

  const handleRemovePlayer = (player) => {
    setEditingPlayer(player);
    setTransactionType('');
    setNewPlayerName('');
    setNewPlayerTeam('');
  };

  const handleSaveTransaction = async () => {
    if (!editingPlayer || !transactionType) return;

    try {
      // Create new transaction
      const newTransaction = {
        type: transactionType,
        date: new Date().toISOString().split('T')[0],
        players_in: transactionType === 'trade' ? [newPlayerName] : [],
        players_out: [editingPlayer.name]
      };

      // Update current squad
      const updatedSquad = squadData.currentSquad.filter(p => p.name !== editingPlayer.name);
      
      // Add new player if trade
      if (transactionType === 'trade' && newPlayerName) {
        updatedSquad.push({
          name: newPlayerName,
          team: newPlayerTeam,
          acquisition_type: 'trade',
          acquisition_date: new Date().toISOString().split('T')[0]
        });
      }

      // Send to API
      const response = await fetch('/api/squads', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: selectedUserId,
          type: transactionType,
          players_in: transactionType === 'trade' ? [{name: newPlayerName, team: newPlayerTeam}] : [],
          players_out: [{name: editingPlayer.name, team: editingPlayer.team}]
        })
      });

      if (!response.ok) throw new Error('Failed to save transaction');

      // Update state
      setSquadData({
        currentSquad: updatedSquad,
        transactions: [...squadData.transactions, newTransaction]
      });

      // Reset editing state
      setEditingPlayer(null);
      setTransactionType('');
      setNewPlayerName('');
      setNewPlayerTeam('');
    } catch (err) {
      console.error('Error saving transaction:', err);
      setError('Failed to save changes');
    }
  };

  const handleSaveDraft = async () => {
    if (!transactionType || !newPlayerName) return;

    try {
      // Create new transaction for draft
      const newTransaction = {
        type: transactionType,
        date: new Date().toISOString().split('T')[0],
        players_in: [newPlayerName],
        players_out: []
      };

      // Add new player to squad
      const updatedSquad = [...squadData.currentSquad, {
        name: newPlayerName,
        team: newPlayerTeam,
        acquisition_type: transactionType,
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
          type: transactionType,
          players_in: [{name: newPlayerName, team: newPlayerTeam}],
          players_out: []
        })
      });

      if (!response.ok) throw new Error('Failed to save draft');

      // Update state
      setSquadData({
        currentSquad: updatedSquad,
        transactions: [...squadData.transactions, newTransaction]
      });

      // Reset form
      setTransactionType('');
      setNewPlayerName('');
      setNewPlayerTeam('');
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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{USER_NAMES[selectedUserId]} - Squad</h1>
        <div className="flex gap-3">
          {isEditing && (
            <button
              onClick={() => {
                setEditingPlayer(null);
                setTransactionType('');
                setNewPlayerName('');
                setNewPlayerTeam('');
              }}
              className="px-4 py-2 rounded-lg flex items-center gap-2 bg-green-500 text-white"
            >
              <UserPlus className="h-5 w-5" />
              Add Player
            </button>
          )}
          <button
            onClick={() => {
              setIsEditing(!isEditing);
              setEditingPlayer(null);
              setTransactionType('');
              setNewPlayerName('');
              setNewPlayerTeam('');
            }}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
              isEditing ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
            }`}
          >
            {isEditing ? <X className="h-5 w-5" /> : <Edit className="h-5 w-5" />}
            {isEditing ? 'Done' : 'Edit Squad'}
          </button>
        </div>
      </div>
      
      {/* Current Squad with Color Coding */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Current Squad</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {squadData.currentSquad.map((player, index) => {
            const typeInfo = getAcquisitionTypeInfo(player.acquisition_type);
            return (
              <div 
                key={index} 
                className={`p-3 rounded-lg ${typeInfo.color} flex items-center gap-3 ${
                  editingPlayer?.name === player.name ? 'ring-2 ring-blue-500' : ''
                }`}
              >
                <typeInfo.icon className="h-5 w-5" />
                <div className="flex-1">
                  <p className="font-medium">{player.name}</p>
                  <p className="text-sm">{player.team}</p>
                  <p className="text-xs mt-1">{typeInfo.label} - {formatDate(player.acquisition_date)}</p>
                </div>
                {isEditing && (
                  <button
                    onClick={() => handleRemovePlayer(player)}
                    className="bg-red-600 text-white p-1 rounded hover:bg-red-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        
        {/* Legend */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <h3 className="text-sm font-semibold mb-2">Legend:</h3>
          <div className="flex flex-wrap gap-4">
            {['initial', 'midseason_draft_1', 'midseason_draft_2', 'trade'].map((type) => {
              const typeInfo = getAcquisitionTypeInfo(type);
              return (
                <div key={type} className="flex items-center gap-2">
                  <div className={`px-2 py-1 rounded text-xs ${typeInfo.color}`}>
                    {typeInfo.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Edit Transaction Form */}
      {editingPlayer && (
        <div className="bg-gray-50 rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Create Transaction</h2>
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">
              Removing: <span className="font-semibold">{editingPlayer.name}</span> ({editingPlayer.team})
            </p>
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Transaction Type:</label>
            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              className="w-full p-2 border rounded"
            >
              <option value="">Select transaction type</option>
              <option value="delist">Delist Player</option>
              <option value="trade">Trade</option>
            </select>
          </div>
          
          {transactionType === 'trade' && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Select New Player:</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded p-2">
                {availablePlayers.map((player, index) => (
                  <button
                    key={index}
                    onClick={() => handlePlayerSelect(player)}
                    className={`p-2 text-left rounded ${
                      newPlayerName === player.name 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'hover:bg-gray-100'
                    }`}
                  >
                    <span className="font-medium">{player.name}</span>
                    <span className="text-sm text-gray-600 ml-2">({player.teamName || player.team})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setEditingPlayer(null)}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveTransaction}
              disabled={!transactionType || (transactionType === 'trade' && !newPlayerName)}
              className={`px-4 py-2 rounded flex items-center gap-2 ${
                transactionType && (transactionType === 'delist' || newPlayerName)
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Save className="h-5 w-5" />
              Save Transaction
            </button>
          </div>
        </div>
      )}

      {/* Mid-Season Draft Form */}
      {isEditing && !editingPlayer && (
        <div className="bg-gray-50 rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Mid-Season Draft</h2>
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Draft Type:</label>
            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              className="w-full p-2 border rounded"
            >
              <option value="">Select draft type</option>
              <option value="midseason_draft_1">Mid-Season Draft 1</option>
              <option value="midseason_draft_2">Mid-Season Draft 2</option>
            </select>
          </div>
          
          {transactionType && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Select Player to Draft:</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded p-2">
                {availablePlayers.map((player, index) => (
                  <button
                    key={index}
                    onClick={() => handlePlayerSelect(player)}
                    className={`p-2 text-left rounded ${
                      newPlayerName === player.name 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'hover:bg-gray-100'
                    }`}
                  >
                    <span className="font-medium">{player.name}</span>
                    <span className="text-sm text-gray-600 ml-2">({player.teamName || player.team})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setTransactionType('');
                setNewPlayerName('');
                setNewPlayerTeam('');
              }}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={!transactionType || !newPlayerName}
              className={`px-4 py-2 rounded flex items-center gap-2 ${
                transactionType && newPlayerName
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Save className="h-5 w-5" />
              Draft Player
            </button>
          </div>
        </div>
      )}

      {/* Squad History */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Squad History</h2>
        <div className="space-y-4">
          {squadData.transactions.map((transaction, index) => {
            const typeInfo = getAcquisitionTypeInfo(transaction.type);
            return (
              <div key={index} className="border-l-4 border-gray-200 pl-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span className="font-medium">{formatDate(transaction.date)}</span>
                  <span className={`px-2 py-1 rounded text-sm ${typeInfo.color}`}>
                    {typeInfo.label}
                  </span>
                </div>
                {transaction.players_in?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-sm font-medium text-green-700">Players In:</p>
                    <p className="text-sm text-green-600">
                      {transaction.players_in.join(', ')}
                    </p>
                  </div>
                )}
                {transaction.players_out?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-red-700">Players Out:</p>
                    <p className="text-sm text-red-600">
                      {transaction.players_out.join(', ')}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
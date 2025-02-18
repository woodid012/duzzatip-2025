'use client';

import React, { useState, useEffect, useRef } from 'react';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';
import { processFixtures, getRoundInfo, USE_TEST_DATE, TEST_DATE } from '@/app/lib/timeCalculations';

const TippingPage = () => {
  const [fixtures, setFixtures] = useState([]);
  const [selectedRound, setSelectedRound] = useState('0');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [tips, setTips] = useState({});
  const [editedTips, setEditedTips] = useState({});
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [roundInfo, setRoundInfo] = useState({
    currentRound: 0,
    currentRoundDisplay: 'Opening Round',
    lockoutTime: null,
    isLocked: false
  });

  useEffect(() => {
    const loadData = async () => {
      try {
        const url = selectedTeam 
          ? `/api/tipping-data?round=${selectedRound}&userId=${selectedTeam}`
          : '/api/tipping-data';
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load data: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Handle both the direct fixtures array and the combined data structure
        const fixtureData = Array.isArray(data) ? data : data.fixtures;
        const tipsData = Array.isArray(data) ? {} : data.tips || {};
        
        // Process fixtures with our timeCalculations utility
        const processedFixtures = processFixtures(fixtureData);
        
        // Get round info for locking
        const roundInfo = getRoundInfo(processedFixtures, parseInt(selectedRound));
        setRoundInfo(roundInfo);

        // Filter fixtures for selected round
        const roundFixtures = processedFixtures.filter(
          fixture => fixture.RoundNumber.toString() === selectedRound
        );

        // If no tips exist for matches, default to home team
        const defaultedTips = {};
        if (selectedTeam) {
          roundFixtures.forEach(fixture => {
            if (!tipsData[fixture.MatchNumber]) {
              defaultedTips[fixture.MatchNumber] = {
                team: fixture.HomeTeam,
                deadCert: false
              };
            }
          });
        }

        const combinedTips = {
          ...defaultedTips,
          ...tipsData
        };

        setFixtures(roundFixtures);
        setTips(combinedTips);
        setEditedTips(combinedTips);
        setLoading(false);
      } catch (error) {
        console.error('Error loading data:', error);
        setLoading(false);
      }
    };

    loadData();
  }, [selectedRound, selectedTeam]);

  const handleTipSelect = (matchNumber, team) => {
    if (!isEditing || roundInfo.isLocked) return;
    
    setEditedTips(prev => ({
      ...prev,
      [matchNumber]: {
        ...prev[matchNumber],
        team
      }
    }));
  };

  const handleDeadCertToggle = (matchNumber) => {
    if (!isEditing || roundInfo.isLocked) return;

    setEditedTips(prev => ({
      ...prev,
      [matchNumber]: {
        ...prev[matchNumber],
        deadCert: !prev[matchNumber]?.deadCert
      }
    }));
  };

  const handleSave = async () => {
    if (roundInfo.isLocked) return;
    
    try {
      const response = await fetch('/api/tipping-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round: selectedRound,
          userId: selectedTeam,
          tips: editedTips
        })
      });

      if (!response.ok) throw new Error('Failed to save');
      
      setTips(editedTips);
      setIsEditing(false);
      setSaveMessage('Tips saved successfully');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Error saving:', error);
      setSaveMessage('Failed to save tips');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  const handleCancel = () => {
    setEditedTips(tips);
    setIsEditing(false);
  };

  const displayRound = (round) => {
    return round === '0' ? 'Opening Round' : `Round ${round}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading fixtures...</div>
      </div>
    );
  }

  const displayTips = isEditing ? editedTips : tips;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-black">AFL {CURRENT_YEAR} Tips</h1>
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
          {saveMessage && (
            <span className={`${saveMessage.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
              {saveMessage}
            </span>
          )}
          {selectedTeam && (
            isEditing ? (
              <>
                <button 
                  onClick={handleSave}
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                >
                  Save Changes
                </button>
                <button 
                  onClick={handleCancel}
                  className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button 
                onClick={() => setIsEditing(true)}
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
            value={selectedRound}
            onChange={(e) => setSelectedRound(e.target.value)}
            className="border rounded p-2 text-black"
          >
            {Array.from({ length: 25 }, (_, i) => (
              <option key={i} value={i.toString()}>
                {displayRound(i.toString())}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="mb-2 font-semibold text-black">Select Team:</label>
          <select 
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
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
            {fixtures.map((fixture) => {
              return (
                <tr key={fixture.MatchNumber} className="hover:bg-gray-50">
                  <td className="py-2 px-4 border text-black">{fixture.DateMelb}</td>
                  <td className="py-2 px-4 border">
                    <button
                      onClick={() => handleTipSelect(fixture.MatchNumber, fixture.HomeTeam)}
                      disabled={!isEditing || roundInfo.isLocked}
                      className={`px-3 py-1 rounded ${
                        displayTips[fixture.MatchNumber]?.team === fixture.HomeTeam
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
                        displayTips[fixture.MatchNumber]?.team === fixture.AwayTeam
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-100 hover:bg-gray-200 text-black'
                      } ${(!isEditing || roundInfo.isLocked) ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      {fixture.AwayTeam}
                    </button>
                  </td>
                  <td className="py-2 px-4 border text-center text-black">
                    {displayTips[fixture.MatchNumber]?.team || '-'}
                  </td>
                  <td className="py-2 px-4 border text-center">
                    <button
                      onClick={() => handleDeadCertToggle(fixture.MatchNumber)}
                      disabled={!isEditing || roundInfo.isLocked || !displayTips[fixture.MatchNumber]?.team}
                      className={`px-3 py-1 rounded ${
                        displayTips[fixture.MatchNumber]?.deadCert
                          ? 'bg-yellow-500 text-white'
                          : 'bg-gray-100 hover:bg-gray-200 text-black'
                      } ${(!isEditing || roundInfo.isLocked || !displayTips[fixture.MatchNumber]?.team) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {displayTips[fixture.MatchNumber]?.deadCert ? 'Yes' : 'No'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TippingPage;
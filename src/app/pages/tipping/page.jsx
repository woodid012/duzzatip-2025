"use client";

import React, { useState, useEffect } from 'react';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';

const TippingPage = () => {
  const [fixtures, setFixtures] = useState([]);
  const [selectedRound, setSelectedRound] = useState('0');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [tips, setTips] = useState({});
  const [editedTips, setEditedTips] = useState({});
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

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
        
        // Process fixtures and convert dates to Melbourne time
        const processedFixtures = fixtureData.map(fixture => ({
          ...fixture,
          DateUtc: new Date(fixture.DateUtc).toLocaleString('en-AU', {
            timeZone: 'Australia/Melbourne',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
          }),
          'Match Number': fixture.MatchNumber,
          'Round Number': fixture.RoundNumber.toString(),
          'Home Team': fixture.HomeTeam,
          'Away Team': fixture.AwayTeam,
          isComplete: fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null
        }));

        const roundFixtures = processedFixtures.filter(
          fixture => fixture['Round Number'] === selectedRound
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
    if (!isEditing) return;
    
    setEditedTips(prev => ({
      ...prev,
      [matchNumber]: {
        ...prev[matchNumber],
        team
      }
    }));
  };

  const handleDeadCertToggle = (matchNumber) => {
    if (!isEditing) return;

    setEditedTips(prev => ({
      ...prev,
      [matchNumber]: {
        ...prev[matchNumber],
        deadCert: !prev[matchNumber]?.deadCert
      }
    }));
  };

  const handleSave = async () => {
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

  const checkTipResult = (fixture, tip) => {
    if (!fixture.isComplete || !tip) return null;
    
    const winningTeam = fixture.HomeTeamScore > fixture.AwayTeamScore 
      ? fixture.HomeTeam 
      : fixture.AwayTeamScore > fixture.HomeTeamScore 
        ? fixture.AwayTeam 
        : 'Draw';
    
    return tip === winningTeam;
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
        <h1 className="text-3xl font-bold">AFL {CURRENT_YEAR} Tips</h1>
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
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
              >
                Edit Tips
              </button>
            )
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="flex flex-col">
          <label className="mb-2 font-semibold">Select Round:</label>
          <select 
            value={selectedRound}
            onChange={(e) => setSelectedRound(e.target.value)}
            className="border rounded p-2"
          >
            {Array.from({ length: 25 }, (_, i) => (
              <option key={i} value={i.toString()}>
                {displayRound(i.toString())}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="mb-2 font-semibold">Select Team:</label>
          <select 
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="border rounded p-2"
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
              <th className="py-2 px-4 border">Date</th>
              <th className="py-2 px-4 border">Home Team</th>
              <th className="py-2 px-4 border">Score</th>
              <th className="py-2 px-4 border">Away Team</th>
              <th className="py-2 px-4 border">Your Tip</th>
              <th className="py-2 px-4 border">Dead Cert</th>
              <th className="py-2 px-4 border">Result</th>
            </tr>
          </thead>
          <tbody>
            {fixtures.map((fixture) => {
              const tipResult = checkTipResult(fixture, displayTips[fixture.MatchNumber]?.team);
              
              return (
                <tr key={fixture.MatchNumber} className="hover:bg-gray-50">
                  <td className="py-2 px-4 border">{fixture.DateUtc}</td>
                  <td className="py-2 px-4 border">
                    <button
                      onClick={() => handleTipSelect(fixture.MatchNumber, fixture.HomeTeam)}
                      disabled={!isEditing}
                      className={`px-3 py-1 rounded ${
                        displayTips[fixture.MatchNumber]?.team === fixture.HomeTeam
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-100 hover:bg-gray-200'
                      } ${!isEditing ? 'cursor-default' : ''}`}
                    >
                      {fixture.HomeTeam}
                    </button>
                  </td>
                  <td className="py-2 px-4 border text-center">
                    {fixture.isComplete ? `${fixture.HomeTeamScore} - ${fixture.AwayTeamScore}` : '-'}
                  </td>
                  <td className="py-2 px-4 border">
                    <button
                      onClick={() => handleTipSelect(fixture.MatchNumber, fixture.AwayTeam)}
                      disabled={!isEditing}
                      className={`px-3 py-1 rounded ${
                        displayTips[fixture.MatchNumber]?.team === fixture.AwayTeam
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-100 hover:bg-gray-200'
                      } ${!isEditing ? 'cursor-default' : ''}`}
                    >
                      {fixture.AwayTeam}
                    </button>
                  </td>
                  <td className="py-2 px-4 border text-center">
                    {displayTips[fixture.MatchNumber]?.team || '-'}
                  </td>
                  <td className="py-2 px-4 border text-center">
                    <button
                      onClick={() => handleDeadCertToggle(fixture.MatchNumber)}
                      disabled={!isEditing || !displayTips[fixture.MatchNumber]?.team}
                      className={`px-3 py-1 rounded ${
                        displayTips[fixture.MatchNumber]?.deadCert
                          ? 'bg-yellow-500 text-white'
                          : 'bg-gray-100 hover:bg-gray-200'
                      } ${(!isEditing || !displayTips[fixture.MatchNumber]?.team) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {displayTips[fixture.MatchNumber]?.deadCert ? 'Yes' : 'No'}
                    </button>
                  </td>
                  <td className="py-2 px-4 border text-center">
                    {fixture.isComplete ? (
                      tipResult === true ? (
                        <span className="text-green-600">✓</span>
                      ) : tipResult === false ? (
                        <span className="text-red-600">✗</span>
                      ) : (
                        '-'
                      )
                    ) : '-'}
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
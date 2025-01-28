"use client";

import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { USER_NAMES } from '@/app/lib/constants';

const TippingPage = () => {
  const [fixtures, setFixtures] = useState([]);
  const [selectedRound, setSelectedRound] = useState('0');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [tips, setTips] = useState({});  // { matchId: { team: teamName, deadCert: boolean } }
  const [loading, setLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    const loadFixtures = async () => {
      try {
        const response = await fetch('/afl-2025-AUSEasternStandardTime.csv');
        if (!response.ok) {
          throw new Error(`Failed to load CSV: ${response.status}`);
        }
        const csvText = await response.text();
        
        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            const processedData = results.data.map(row => ({
              ...row,
              'Round Number': row['Round Number'] === 'OR' ? '0' : row['Round Number']
            }));
            setFixtures(processedData);
            setLoading(false);
          },
          error: (error) => {
            console.error('Error parsing CSV:', error);
            setLoading(false);
          }
        });
      } catch (error) {
        console.error('Error loading fixtures:', error);
        setLoading(false);
      }
    };

    loadFixtures();

    // Load saved tips from localStorage
    const savedTips = localStorage.getItem('aflTips');
    if (savedTips) {
      setTips(JSON.parse(savedTips));
    }
  }, []);

  const filteredFixtures = fixtures.filter(fixture => 
    fixture['Round Number'].toString() === selectedRound
  );

  const handleTipSelect = (matchNumber, team) => {
    setTips(prev => ({
      ...prev,
      [matchNumber]: {
        team,
        deadCert: prev[matchNumber]?.deadCert || false
      }
    }));
  };

  const handleDeadCertToggle = (matchNumber) => {
    setTips(prev => ({
      ...prev,
      [matchNumber]: {
        ...prev[matchNumber],
        deadCert: !prev[matchNumber]?.deadCert
      }
    }));
  };

  const handleSave = () => {
    const timestamp = new Date().toLocaleString();
    const tipsWithTimestamp = {
      tips,
      timestamp,
      round: selectedRound
    };
    localStorage.setItem('aflTips', JSON.stringify(tipsWithTimestamp));
    setSavedMessage(`Tips saved at ${timestamp}`);
    setTimeout(() => setSavedMessage(''), 3000);
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

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">AFL 2025 Tips</h1>
        <div className="flex items-center gap-4">
          {savedMessage && (
            <span className="text-green-600">{savedMessage}</span>
          )}
          <button 
            onClick={handleSave}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
          >
            Save Tips
          </button>
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
            <tr className="bg-black-100">
              <th className="py-2 px-4 border">Home Team</th>
              <th className="py-2 px-4 border">Away Team</th>
              <th className="py-2 px-4 border">Your Tip</th>
              <th className="py-2 px-4 border">Dead Cert</th>
            </tr>
          </thead>
          <tbody>
            {filteredFixtures.map((fixture) => (
              <tr key={fixture['Match Number']} className="hover:bg-black-50">
                <td className="py-2 px-4 border">
                  <button
                    onClick={() => handleTipSelect(fixture['Match Number'], fixture['Home Team'])}
                    className={`px-3 py-1 rounded ${
                      tips[fixture['Match Number']]?.team === fixture['Home Team']
                        ? 'bg-green-500 text-white'
                        : 'bg-black-100 hover:bg-black-200'
                    }`}
                  >
                    {fixture['Home Team']}
                  </button>
                </td>
                <td className="py-2 px-4 border">
                  <button
                    onClick={() => handleTipSelect(fixture['Match Number'], fixture['Away Team'])}
                    className={`px-3 py-1 rounded ${
                      tips[fixture['Match Number']]?.team === fixture['Away Team']
                        ? 'bg-green-500 text-white'
                        : 'bg-black-100 hover:bg-black-200'
                    }`}
                  >
                    {fixture['Away Team']}
                  </button>
                </td>
                <td className="py-2 px-4 border text-center">
                  {tips[fixture['Match Number']]?.team || '-'}
                </td>
                <td className="py-2 px-4 border text-center">
                  <button
                    onClick={() => handleDeadCertToggle(fixture['Match Number'])}
                    disabled={!tips[fixture['Match Number']]?.team}
                    className={`px-3 py-1 rounded ${
                      tips[fixture['Match Number']]?.deadCert
                        ? 'bg-yellow-500 text-white'
                        : 'bg-black-100 hover:bg-black-200'
                    } ${!tips[fixture['Match Number']]?.team ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {tips[fixture['Match Number']]?.deadCert ? 'Yes' : 'No'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TippingPage;
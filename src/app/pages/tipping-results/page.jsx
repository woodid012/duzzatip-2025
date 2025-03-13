"use client";

import React, { useState, useEffect } from 'react';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';
import { useAppContext } from '@/app/context/AppContext';

const TippingResultsGrid = () => {
  const { currentRound } = useAppContext();
  const [selectedRound, setSelectedRound] = useState(currentRound.toString());
  const [fixtures, setFixtures] = useState([]);
  const [allUserTips, setAllUserTips] = useState({});
  const [yearTotals, setYearTotals] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Update selectedRound when currentRound changes
  useEffect(() => {
    setSelectedRound(currentRound.toString());
  }, [currentRound]);

  useEffect(() => {
    const loadAllResults = async () => {
      setLoading(true);
      setError(null);

      try {
        // Load fixtures first
        const fixturesResponse = await fetch(`/api/tipping-data`);
        if (!fixturesResponse.ok) throw new Error('Failed to load fixtures');
        const fixtureData = await fixturesResponse.json();
        
        const roundFixtures = fixtureData.filter(f => f.RoundNumber.toString() === selectedRound)
          .sort((a, b) => a.MatchNumber - b.MatchNumber);
        setFixtures(roundFixtures);

        // Load tips for all users
        const userTipsPromises = Object.keys(USER_NAMES).map(userId => 
          Promise.all([
            fetch(`/api/tipping-results?round=${selectedRound}&userId=${userId}`).then(res => res.json()),
            fetch(`/api/tipping-results?year=${CURRENT_YEAR}&userId=${userId}`).then(res => res.json())
          ])
        );

        const allResults = await Promise.all(userTipsPromises);
        const tipsMap = {};
        const yearTotalsMap = {};
        
        allResults.forEach(([roundResult, yearResult], index) => {
          const userId = Object.keys(USER_NAMES)[index];
          
          // Process the matches and add default home team selections if needed
          const processedMatches = roundResult.completedMatches.map(match => {
            // If there's no tip, use the home team as default
            if (!match.tip) {
              return {
                ...match,
                tip: match.homeTeam,
                isDefault: true
              };
            }
            return match;
          });
          
          tipsMap[userId] = {
            matches: processedMatches,
            correctTips: roundResult.correctTips,
            deadCertScore: roundResult.deadCertScore,
            totalScore: roundResult.totalScore
          };
          
          yearTotalsMap[userId] = {
            correctTips: yearResult.correctTips,
            deadCertScore: yearResult.deadCertScore
          };
        });

        setAllUserTips(tipsMap);
        setYearTotals(yearTotalsMap);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadAllResults();
  }, [selectedRound]);

  const displayRound = (round) => {
    return round === '0' ? 'Opening Round' : `Round ${round}`;
  };

  const getWinningTeam = (fixture) => {
    if (fixture.HomeTeamScore === null || fixture.AwayTeamScore === null) return null;
    if (fixture.HomeTeamScore > fixture.AwayTeamScore) return fixture.HomeTeam;
    if (fixture.AwayTeamScore > fixture.HomeTeamScore) return fixture.AwayTeam;
    return 'Draw';
  };
  
  // Function to convert team names to abbreviations
  const getTeamAbbreviation = (teamName) => {
    if (!teamName) return '';
    
    // Common AFL team abbreviations
    const abbreviations = {
      'Adelaide': 'ADE',
      'Brisbane Lions': 'BRL',
      'Brisbane': 'BRL',
      'Carlton': 'CAR',
      'Collingwood': 'COL',
      'Essendon': 'ESS',
      'Fremantle': 'FRE',
      'Geelong': 'GEE',
      'Gold Coast': 'GCS',
      'Greater Western Sydney': 'GWS',
      'GWS Giants': 'GWS',
      'Hawthorn': 'HAW',
      'Melbourne': 'MEL',
      'North Melbourne': 'NTH',
      'Port Adelaide': 'PTA',
      'Richmond': 'RIC',
      'St Kilda': 'STK',
      'Sydney': 'SYD',
      'West Coast': 'WCE',
      'Western Bulldogs': 'WBD',
      'Bulldogs': 'WBD'
    };
    
    // Try to find the exact match first
    if (abbreviations[teamName]) {
      return abbreviations[teamName];
    }
    
    // If no exact match, try to find a partial match
    for (const [team, abbr] of Object.entries(abbreviations)) {
      if (teamName.includes(team)) {
        return abbr;
      }
    }
    
    // If no match found, return the first 3 letters
    return teamName.substring(0, 3).toUpperCase();
  };

  if (loading) return <div className="p-8 text-center">Loading results...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h1 className="text-3xl font-bold text-black">Round Summary - {displayRound(selectedRound)}</h1>
          <select 
            value={selectedRound}
            onChange={(e) => setSelectedRound(e.target.value)}
            className="border rounded p-2 text-black"
          >
            {Array.from({ length: 25 }, (_, i) => (
              <option key={i} value={i.toString()} className="text-black">
                {displayRound(i.toString())}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full bg-white border">
          <thead>
            <tr>
              <th className="py-2 px-4 border sticky left-0 bg-gray-100 z-10 text-black" rowSpan={3}>Team</th>
              <th className="py-2 px-4 border bg-gray-100 text-black" rowSpan={3}>Year Tips</th>
              <th className="py-2 px-4 border bg-gray-100 text-black" rowSpan={3}>Year Dead Certs</th>
              <th className="py-2 px-4 border bg-gray-100 text-black" rowSpan={3}>Round Tips</th>
              <th className="py-2 px-4 border bg-gray-100 text-black" rowSpan={3}>Round Dead Certs</th>
              {fixtures.map(fixture => (
                <th key={fixture.MatchNumber} className="py-1 px-2 border bg-gray-100 text-center text-black">
                  Game {fixture.MatchNumber}
                </th>
              ))}
            </tr>
            <tr className="bg-gray-50">
              {fixtures.map(fixture => (
                <td key={`h-${fixture.MatchNumber}`} className="py-1 px-2 border text-center whitespace-nowrap text-black">
                  H - {getTeamAbbreviation(fixture.HomeTeam)} ({fixture.HomeTeamScore ?? '-'})
                </td>
              ))}
            </tr>
            <tr className="bg-gray-50">
              {fixtures.map(fixture => (
                <td key={`a-${fixture.MatchNumber}`} className="py-1 px-2 border text-center whitespace-nowrap text-black">
                  A - {getTeamAbbreviation(fixture.AwayTeam)} ({fixture.AwayTeamScore ?? '-'})
                  <div className="text-xs font-medium text-black">
                    {fixture.HomeTeamScore !== null ? `W - ${getTeamAbbreviation(getWinningTeam(fixture))}` : ''}
                  </div>
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(USER_NAMES)
              .sort((a, b) => {
                // Sort by year tips (highest first)
                const aTips = yearTotals[a[0]]?.correctTips || 0;
                const bTips = yearTotals[b[0]]?.correctTips || 0;
                
                // If tied on correctTips, sort by deadCertScore
                if (bTips === aTips) {
                  return (yearTotals[b[0]]?.deadCertScore || 0) - (yearTotals[a[0]]?.deadCertScore || 0);
                }
                
                return bTips - aTips;
              })
              .map(([userId, userName]) => {
                const userResults = allUserTips[userId];
                return (
                  <tr key={userId} className="hover:bg-gray-50">
                    <td className="py-2 px-4 border sticky left-0 bg-white z-10 font-medium text-black">
                      {userName}
                    </td>
                    <td className="py-2 px-4 border text-center font-medium text-black">
                      {yearTotals[userId]?.correctTips || 0}
                    </td>
                    <td className="py-2 px-4 border text-center font-medium text-black">
                      {yearTotals[userId]?.deadCertScore || 0}
                    </td>
                    <td className="py-2 px-4 border text-center font-medium text-black">
                      {userResults?.correctTips || 0}
                    </td>
                    <td className="py-2 px-4 border text-center font-medium text-black">
                      {userResults?.deadCertScore || 0}
                    </td>
                    {fixtures.map(fixture => {
                      const matchTip = userResults?.matches?.find(m => m.matchNumber === fixture.MatchNumber);
                      const isCorrect = matchTip?.correct;
                      const isDeadCert = matchTip?.deadCert;
                      const isDefault = matchTip?.isDefault;
                      
                      return (
                        <td key={fixture.MatchNumber} className="py-2 px-4 border text-center">
                          <div 
                            className={`
                              ${isCorrect ? 'text-green-600' : 'text-red-600'}
                              ${!matchTip?.tip ? 'text-black' : ''}
                              ${isDefault ? 'italic text-gray-500' : 'font-medium'}
                            `}
                          >
                            {matchTip?.tip ? getTeamAbbreviation(matchTip.tip) : '-'}
                            {isDefault && <span className="ml-1">(Def)</span>}
                            {isDeadCert && (
                              <span className="ml-1 text-sm text-black">
                                ({isCorrect ? '+6' : '-12'})
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TippingResultsGrid;
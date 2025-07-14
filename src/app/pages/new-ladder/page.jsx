'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { useAppContext } from '@/app/context/AppContext';

const NewLadderPage = () => {
  const [round, setRound] = useState('');
  const [ladderData, setLadderData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { roundInfo } = useAppContext();

  const maxRound = roundInfo?.currentRound || 0;

  useEffect(() => {
    if (round) {
      fetchLadderData(round);
    }
  }, [round]);

  const fetchLadderData = async (selectedRound) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/consolidated-round-results?round=${selectedRound}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setLadderData(data.data || []);
    } catch (e) {
      console.error("Failed to fetch ladder data:", e);
      setError("Failed to load ladder data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRoundChange = (value) => {
    setRound(value);
  };

  return (
    <div className="container mx-auto p-4">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>New Ladder - Round Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4 mb-4">
            <label htmlFor="round-select" className="text-sm font-medium">Select Round:</label>
            <Select onValueChange={handleRoundChange} value={round}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select a round" />
              </SelectTrigger>
              <SelectContent>
                {[...Array(maxRound).keys()].map((r) => (
                  <SelectItem key={r + 1} value={String(r + 1)}>
                    Round {r + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading && <p>Loading ladder data...</p>}
          {error && <p className="text-red-500">Error: {error}</p>}

          {!loading && !error && ladderData.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Total Score</TableHead>
                  <TableHead>Team Score</TableHead>
                  <TableHead>Dead Certs</TableHead>
                  <TableHead>Wins</TableHead>
                  <TableHead>Star</TableHead>
                  <TableHead>Crab</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ladderData.map((userResult) => (
                  <TableRow key={userResult.userId}>
                    <TableCell className="font-medium">{userResult.userName}</TableCell>
                    <TableCell>{userResult.totalScore}</TableCell>
                    <TableCell>{userResult.teamScore}</TableCell>
                    <TableCell>{userResult.deadCertScore}</TableCell>
                    <TableCell>{userResult.wins}</TableCell>
                    <TableCell>{userResult.isStar ? '⭐' : ''}</TableCell>
                    <TableCell>{userResult.isCrab ? '🦀' : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && !error && ladderData.length === 0 && round && (
            <p>No data available for Round {round}.</p>
          )}
          {!loading && !error && !round && (
            <p>Please select a round to view results.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default NewLadderPage;
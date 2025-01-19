'use client'

import React, { useState } from 'react';
import Image from 'next/image';
import { POSITIONS } from './lib/scoring_rules';
import logo from '@/app/assets/logo.png';
import TeamCard from './components/TeamCard';

// Helper Functions
const createEmptyStats = () => ({
  goals: 0,
  behinds: 0,
  marks: 0,
  kicks: 0,
  disposals: 0,
  handballs: 0,
  tackles: 0,
  hitouts: 0
});

const createEmptyTeam = (teamName) => ({
  name: teamName,
  players: [
    { name: "", position: "FORWARD", stats: createEmptyStats() },
    { name: "", position: "TALL_FORWARD", stats: createEmptyStats() },
    { name: "", position: "OFFENSIVE", stats: createEmptyStats() },
    { name: "", position: "MIDFIELDER", stats: createEmptyStats() },
    { name: "", position: "TACKLER", stats: createEmptyStats() },
    { name: "", position: "RUCK", stats: createEmptyStats() }
  ],
  bench: {
    backup: { position: "MIDFIELDER", stats: createEmptyStats() },
    reserves: [
      { position: "FORWARD", stats: createEmptyStats() },
      { position: "TACKLER", stats: createEmptyStats() }
    ]
  }
});

const matches = [
  {
    id: 1,
    teamA: createEmptyTeam("Team 1"),
    teamB: createEmptyTeam("Team 2")
  },
  {
    id: 2,
    teamA: createEmptyTeam("Team 3"),
    teamB: createEmptyTeam("Team 4")
  },
  {
    id: 3,
    teamA: createEmptyTeam("Team 5"),
    teamB: createEmptyTeam("Team 6")
  },
  {
    id: 4,
    teamA: createEmptyTeam("Team 7"),
    teamB: createEmptyTeam("Team 8")
  }
];

const Logo = ({ width = 150, height = 50, alt = "Company Logo", className = "" }) => {
  return (
    <Image 
      src={logo}
      alt={alt}
      width={width}
      height={height}
      className={`object-contain ${className}`}
      priority
    />
  );
};

function Home() {
  const [selectedRound, setSelectedRound] = useState(1);
  const totalRounds = 23;

  return (
    <div className="max-w-[1400px] mx-auto p-6">
      <div className="grid grid-cols-3 items-center mb-8 px-4 gap-4">
        <div className="flex-shrink-0">
          <Logo width={176} height={176} className="rounded-lg" />
        </div>
        
        <div className="flex flex-col items-center justify-center">
          <div className="flex items-center gap-3">
            <label htmlFor="round" className="font-medium text-gray-700">
              Round:
            </label>
            <select
              id="round"
              value={selectedRound}
              onChange={(e) => setSelectedRound(Number(e.target.value))}
              className="p-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {Array.from({ length: totalRounds }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Round {i + 1}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3 justify-end">
          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Username"
              className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password"
              placeholder="Password"
              className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button 
            className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Login
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {matches.map(match => (
          <div key={match.id} className="bg-gray-50 rounded-xl p-6 shadow-md">
            <h2 className="text-xl font-bold text-center text-gray-800 mb-6">
              Match {match.id}
            </h2>
            <div className="flex flex-col md:flex-row gap-4 items-stretch">
              <TeamCard team={match.teamA} />
              <TeamCard team={match.teamB} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Home;
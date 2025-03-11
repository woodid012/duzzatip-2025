'use client'

import Link from 'next/link';
import { USER_NAMES, CURRENT_YEAR } from '@/app/lib/constants';

export default function WelcomeScreen({ selectedUserId, setSelectedUserId, lockoutTime }) {
  // Format the lockout time safely
  const formattedLockoutTime = lockoutTime || 'Not yet determined';
  
  // Handle player selection change  
  const handlePlayerChange = (e) => {
    const newUserId = e.target.value;
    if (typeof window !== 'undefined') {
      // Store in localStorage
      localStorage.setItem('selectedUserId', newUserId);
    }
    // Update context
    if (setSelectedUserId) {
      setSelectedUserId(newUserId);
    }
  };
    
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl w-full space-y-8 text-center">
        <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl sm:tracking-tight">
          Welcome to DuzzaTip {CURRENT_YEAR}
        </h1>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-8">
          <h2 className="text-2xl font-bold text-blue-800 mb-4">Opening Round Information</h2>
          
          <div className="text-blue-700 mb-6">
            <p className="mb-2">The competition begins with the Opening Round.</p>
            <p className="text-xl font-semibold mt-4">
              Lockout Time: {formattedLockoutTime}
            </p>
            <p className="mt-2">Make sure to submit your team before the lockout!</p>
          </div>
          
          <div className="mt-8 mb-6 flex justify-center">
            <div className="w-full max-w-xs">
              <label htmlFor="player-select" className="block text-sm font-medium text-blue-800 mb-2">
                Select Your Player:
              </label>
              <select
                id="player-select"
                value={selectedUserId}
                onChange={handlePlayerChange}
                className="w-full p-3 border border-blue-300 rounded-md text-base text-black bg-white"
              >
                <option value="">Select Player</option>
                {Object.entries(USER_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/pages/team-selection" className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-lg font-medium">
              Enter Your Team
            </Link>
            
            <Link href="/pages/tipping" className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 text-lg font-medium">
              Enter Your Tips
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
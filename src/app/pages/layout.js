'use client'

import { useEffect, useState, createContext, useContext } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAppContext } from '@/app/context/AppContext';
import logo from '@/app/assets/logo.png';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

// Create context for selected user
export const UserContext = createContext({
  selectedUserId: '',
  setSelectedUserId: () => {},
});

// Custom hook to use the user context
export const useUserContext = () => useContext(UserContext);

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

export default function PagesLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { roundInfo, loading } = useAppContext();
  
  // State for selected user - initialize from localStorage if available
  const [selectedUserId, setSelectedUserId] = useState('');
  
  // Load selectedUserId from localStorage on initial render
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUserId = localStorage.getItem('selectedUserId');
      if (savedUserId) {
        setSelectedUserId(savedUserId);
      }
    }
  }, []);
  
  // Save selectedUserId to localStorage when it changes
  useEffect(() => {
    if (selectedUserId && typeof window !== 'undefined') {
      localStorage.setItem('selectedUserId', selectedUserId);
    }
  }, [selectedUserId]);

  // Redirect to results page if at root
  useEffect(() => {
    if (pathname === '/pages' || pathname === '/pages/') {
      router.push('/pages/results');
    }
  }, [pathname, router]);

  // Handle user selection change
  const handleUserChange = (e) => {
    setSelectedUserId(e.target.value);
  };

  const navigationItems = [
    { name: 'Round Results', path: '/pages/results', id: 'results' },
    { name: 'Enter Team', path: '/pages/team-selection', id: 'team-selection' },
    { name: 'Enter Tips', path: '/pages/tipping', id: 'tipping' },
    { name: 'Season Ladder', path: '/pages/ladder', id: 'ladder' },
    { name: 'Tip Results', path: '/pages/tipping-results', id: 'tipping-results' },
    { name: 'Squads', path: '/pages/squads', id: 'squads' },
  ];

  // Check if the current page should show only the selected user's team
  const isSingleUserPage = pathname === '/pages/team-selection' || pathname === '/pages/tipping';

  // Determine if we should show round info yet
  const showRoundInfo = !loading.fixtures && roundInfo && roundInfo.currentRound !== undefined;

  return (
    <UserContext.Provider value={{ selectedUserId, setSelectedUserId }}>
      <div className="min-h-screen bg-gray-50">
        {/* Top Banner */}
        <div className="bg-white shadow">
          <div className="w-full p-4 md:p-6">
            <div className="flex flex-col gap-2">
              <div className="flex-shrink-0 px-4">
                <Logo width={176} height={176} className="rounded-lg" />
              </div>
              
              {/* Competition Info Bar */}
              <div className="flex flex-wrap justify-between items-center px-4 text-sm text-gray-600">
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Season:</span>
                    <span>{CURRENT_YEAR}</span>
                  </div>
                  
                  {/* Only show round info when it's fully loaded */}
                  {showRoundInfo ? (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Current Round:</span>
                      <span>{roundInfo.currentRoundDisplay}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Round:</span>
                      <span className="animate-pulse">Loading...</span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 text-sm">
                    {showRoundInfo && roundInfo.lockoutTime && (
                      <div className="flex gap-1 items-center">
                        <span className="text-gray-600">Lockout:</span>
                        <span className="font-medium text-black">{roundInfo.lockoutTime}</span>
                        {roundInfo.isLocked && (
                          <span className="text-red-600">(Locked)</span>
                        )}
                      </div>
                    )}
                    {showRoundInfo && roundInfo.lockoutTime && roundInfo.roundEndTime && (
                      <span className="text-gray-400 mx-1">|</span>
                    )}
                    {showRoundInfo && roundInfo.roundEndTime && (
                      <div className="flex gap-1 items-center">
                        <span className="text-gray-600">Round Ends:</span>
                        <span className="font-medium text-black">{roundInfo.roundEndTime}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* User Selection Dropdown */}
                <div className="flex items-center mt-2 sm:mt-0">
                  <select
                    value={selectedUserId}
                    onChange={handleUserChange}
                    className="p-2 border rounded text-base text-black bg-white w-48"
                  >
                    <option value="">Select Player</option>
                    {Object.entries(USER_NAMES).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="w-full">
          <div className="flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6">
            {/* Navigation Sidebar */}
            <div className="md:w-48 md:flex-shrink-0">
              <div className="bg-white rounded-lg shadow p-2 md:p-4">
                <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible">
                  {navigationItems.map((item) => (
                    <Link 
                      key={item.id}
                      href={item.path}
                      className={`flex-shrink-0 md:flex-shrink block px-4 py-2 rounded-md transition-colors text-left whitespace-nowrap ${
                        pathname === item.path
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {item.name}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 bg-white rounded-lg shadow p-4 md:p-6">
              {children}
            </div>
          </div>
        </div>
      </div>
    </UserContext.Provider>
  );
}
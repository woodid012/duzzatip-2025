'use client'

import { useEffect, useState, createContext, useContext } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAppContext } from '@/app/context/AppContext';
import logo from '@/app/assets/logo.png';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

// Create context for selected user and admin authentication
export const UserContext = createContext({
  selectedUserId: '',
  setSelectedUserId: () => {},
  isAdminAuthenticated: false,
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
  
  // Admin authentication state
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  
  // Load selectedUserId from localStorage on initial render
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUserId = localStorage.getItem('selectedUserId');
      if (savedUserId) {
        // If user was previously admin, we need to revalidate
        if (savedUserId === 'admin') {
          setShowAdminModal(true);
        } else {
          setSelectedUserId(savedUserId);
        }
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
    const newUserId = e.target.value;
    
    if (newUserId === 'admin') {
      // Show admin password modal when admin is selected
      setShowAdminModal(true);
    } else {
      setSelectedUserId(newUserId);
      setIsAdminAuthenticated(false);
    }
  };
  
  // Handle admin password submission
  const handleAdminPasswordSubmit = (e) => {
    e.preventDefault();
    
    if (adminPassword === 'Duz') {
      setIsAdminAuthenticated(true);
      setSelectedUserId('admin');
      setShowAdminModal(false);
    } else {
      alert('Incorrect password');
    }
  };

  const navigationItems = [
    { name: 'Round Results', path: '/pages/results', id: 'results' },
    { name: 'Enter Team', path: '/pages/team-selection', id: 'team-selection' },
    { name: 'Enter Tips', path: '/pages/tipping', id: 'tipping' },
    { name: 'Season Ladder', path: '/pages/ladder', id: 'ladder' },
    { name: 'Tip Results', path: '/pages/tipping-results', id: 'tipping-results' },
    { name: 'Squads', path: '/pages/squads', id: 'squads' },
    { name: 'Squad Management', path: '/pages/squad-management', id: 'squad-management' },
  ];

  // Check if the current page should show only the selected user's team
  const isSingleUserPage = pathname === '/pages/team-selection' || pathname === '/pages/tipping';

  // Determine if we should show round info yet
  const showRoundInfo = !loading.fixtures && roundInfo && roundInfo.currentRound !== undefined;

  return (
    <UserContext.Provider value={{ 
      selectedUserId, 
      setSelectedUserId, 
      isAdminAuthenticated,
      setIsAdminAuthenticated
    }}>
      <div className="min-h-screen bg-gray-50">
        {/* Admin Password Modal */}
        {showAdminModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-xl font-bold mb-4">Admin Authentication</h3>
              <form onSubmit={handleAdminPasswordSubmit}>
                <div className="mb-4">
                  <label htmlFor="adminPassword" className="block text-sm font-medium text-gray-700 mb-1">
                    Admin Password
                  </label>
                  <input
                    type="password"
                    id="adminPassword"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full p-2 border rounded text-black"
                    placeholder="Enter password"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdminModal(false);
                      setAdminPassword('');
                      // Reset dropdown to previous value
                      if (typeof window !== 'undefined') {
                        const savedUserId = localStorage.getItem('selectedUserId');
                        if (savedUserId && savedUserId !== 'admin') {
                          setSelectedUserId(savedUserId);
                        } else {
                          setSelectedUserId('');
                        }
                      }
                    }}
                    className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Login
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      
        {/* Top Banner */}
        <div className="bg-white shadow">
          <div className="w-full p-3 md:p-6">
            {/* Mobile Layout (md:hidden) */}
            <div className="flex items-start gap-3 md:hidden">
              {/* Logo - Smaller on Mobile */}
              <div className="flex-shrink-0">
                <Logo 
                  width={80} 
                  height={80} 
                  className="rounded-lg" 
                />
              </div>
              
              {/* Right side content on mobile */}
              <div className="flex-1 min-w-0">
                {/* Competition Info - Compact on Mobile */}
                <div className="space-y-1 text-xs text-gray-600 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Season:</span>
                    <span>{CURRENT_YEAR}</span>
                  </div>
                  
                  {/* Only show round info when it's fully loaded */}
                  {showRoundInfo ? (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Round:</span>
                      <span>{roundInfo.currentRoundDisplay}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Round:</span>
                      <span className="animate-pulse">Loading...</span>
                    </div>
                  )}
                  
                  {/* Lockout info - Stacked on mobile */}
                  {showRoundInfo && roundInfo.lockoutTime && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-600">Lockout:</span>
                        <span className="font-medium text-black text-xs">{roundInfo.lockoutTime}</span>
                        {roundInfo.isLocked && (
                          <span className="text-red-600 text-xs">(Locked)</span>
                        )}
                      </div>
                      {roundInfo.roundEndTime && (
                        <div className="flex items-center gap-1">
                          <span className="text-gray-600">Ends:</span>
                          <span className="font-medium text-black text-xs">{roundInfo.roundEndTime}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* User Selection - Full width on mobile */}
                <div className="w-full">
                  <select
                    value={selectedUserId}
                    onChange={handleUserChange}
                    className="w-full p-2 border rounded text-sm text-black bg-white"
                  >
                    <option value="">Select Player</option>
                    {Object.entries(USER_NAMES).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                    <option value="admin">Admin</option>
                  </select>
                  
                  {/* Admin indicator */}
                  {selectedUserId === 'admin' && isAdminAuthenticated && (
                    <span className="inline-block mt-1 px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                      Admin Mode
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Desktop Layout (hidden md:block) */}
            <div className="hidden md:block">
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
                    
                    {/* Admin indicator */}
                    {selectedUserId === 'admin' && isAdminAuthenticated && (
                      <span className="ml-2 px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                        Admin Mode
                      </span>
                    )}
                  </div>
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
                      className={`flex-shrink-0 md:flex-shrink block px-3 py-2 md:px-4 rounded-md transition-colors text-left whitespace-nowrap text-sm ${
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
              {selectedUserId === 'admin' && !isAdminAuthenticated ? (
                // Show a message if somehow the admin access is attempted without auth
                <div className="p-8 text-center">
                  <h2 className="text-xl font-bold mb-4">Admin Authentication Required</h2>
                  <p className="mb-4">You need to authenticate as an admin to view this content.</p>
                  <button
                    onClick={() => setShowAdminModal(true)}
                    className="px-4 py-2 bg-blue-500 text-white rounded"
                  >
                    Authenticate
                  </button>
                </div>
              ) : (
                // Show the content if authorized or not an admin
                children
              )}
            </div>
          </div>
        </div>
      </div>
    </UserContext.Provider>
  );
}
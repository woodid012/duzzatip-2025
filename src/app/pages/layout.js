'use client'

import { useEffect, useState, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAppContext } from '@/app/context/AppContext';
import Logo from '@/app/components/Logo';
import { getNavigationGroups, debugNavigationItems } from '@/app/lib/navigationConfig';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';

// Create context for selected user and admin authentication
export const UserContext = createContext({
  selectedUserId: '',
  setSelectedUserId: () => {},
  isAdminAuthenticated: false,
});

// Custom hook to use the user context
export const useUserContext = () => useContext(UserContext);


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
  
  // Mobile navigation state
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  
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

  // Close mobile nav when route changes
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

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

  const navigationGroups = getNavigationGroups(true); // Include Squad Management

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
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
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
      
        {/* Mobile Header */}
        <div className="md:hidden bg-white shadow-sm">
          <div className="flex items-center justify-between p-3">
            {/* Logo and hamburger */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
                className="p-2 rounded-md hover:bg-gray-100"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <Logo width={40} height={40} className="rounded" />
            </div>
            
            {/* User selector - mobile optimized */}
            <div className="flex-1 max-w-xs ml-3">
              <select
                value={selectedUserId}
                onChange={handleUserChange}
                className="w-full p-2 text-sm border rounded text-black bg-white"
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
                <div className="text-xs text-amber-600 font-medium mt-1">
                  Admin Mode
                </div>
              )}
            </div>
          </div>
          
          {/* Mobile round info */}
          {showRoundInfo && (
            <div className="px-3 pb-3 text-xs space-y-1 border-t bg-gray-50">
              <div className="flex items-center justify-between">
                <span className="font-medium">Season {CURRENT_YEAR}</span>
                <span className="font-medium">{roundInfo.currentRoundDisplay}</span>
              </div>
              
              {roundInfo.lockoutTime && (
                <div className="flex items-center justify-between">
                  <span>Lockout:</span>
                  <div>
                    <span className="font-medium">{roundInfo.lockoutTime}</span>
                    {roundInfo.isLocked && (
                      <span className="text-red-600 ml-1">(Locked)</span>
                    )}
                  </div>
                </div>
              )}
              
              {roundInfo.roundEndTime && (
                <div className="flex items-center justify-between">
                  <span>Ends:</span>
                  <span className="font-medium">{roundInfo.roundEndTime}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile Navigation Overlay */}
        {isMobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-40 bg-black bg-opacity-50" onClick={() => setIsMobileNavOpen(false)}>
            <div className="absolute left-0 top-0 h-full w-80 max-w-sm bg-white shadow-xl">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Navigation</h2>
                  <button
                    onClick={() => setIsMobileNavOpen(false)}
                    className="p-2 rounded-md hover:bg-gray-100"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              
              <nav className="p-4">
                <div className="space-y-2">
                  {navigationGroups.map((group, groupIndex) => (
                    <div key={groupIndex}>
                      {group.map((item) => (
                        <Link 
                          key={item.id}
                          href={item.path}
                          className={`block px-4 py-3 mb-2 rounded-md transition-colors ${
                            pathname === item.path
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-700 hover:bg-gray-100'
                          }`}
                          onClick={() => setIsMobileNavOpen(false)}
                        >
                          {item.name}
                        </Link>
                      ))}
                      {groupIndex < navigationGroups.length - 1 && (
                        <div className="border-t border-gray-200 my-1"></div>
                      )}
                    </div>
                  ))}
                </div>
              </nav>
            </div>
          </div>
        )}

        {/* Desktop Header */}
        <div className="hidden md:block bg-white shadow">
          <div className="w-full p-3 md:p-6">
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

        {/* Main Content Area */}
        <div className="w-full">
          {/* Desktop Layout with Sidebar */}
          <div className="hidden md:flex gap-6 p-6">
            {/* Navigation Sidebar */}
            <div className="w-48 flex-shrink-0">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex flex-col gap-2">
                  {navigationGroups.map((group, groupIndex) => (
                    <div key={groupIndex}>
                      {group.map((item) => (
                        <Link 
                          key={item.id}
                          href={item.path}
                          className={`block px-4 py-2 mb-2 rounded-md transition-colors text-left text-sm ${
                            pathname === item.path
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {item.name}
                        </Link>
                      ))}
                      {groupIndex < navigationGroups.length - 1 && (
                        <div className="border-t border-gray-200 my-1"></div>
                      )}
                    </div>
                  ))}
                </div>
                {selectedUserId === 'admin' && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Debug</h3>
                    <div className="flex flex-col gap-2">
                      {debugNavigationItems.map((item) => (
                        <Link
                          key={item.id}
                          href={item.path}
                          className={`block px-4 py-2 rounded-md transition-colors text-left text-sm ${
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
                )}
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 bg-white rounded-lg shadow p-6">
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

          {/* Mobile Layout - Full Width Content */}
          <div className="md:hidden">
            <div className="bg-white">
              {selectedUserId === 'admin' && !isAdminAuthenticated ? (
                // Show a message if somehow the admin access is attempted without auth
                <div className="p-6 text-center">
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

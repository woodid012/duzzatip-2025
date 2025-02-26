'use client'

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAppContext } from '@/app/context/AppContext';
import logo from '@/app/assets/logo.png';
import { CURRENT_YEAR } from '@/app/lib/constants';

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
  const { roundInfo } = useAppContext();

  // Redirect to results page if at root
  useEffect(() => {
    if (pathname === '/pages' || pathname === '/pages/') {
      router.push('/pages/results');
    }
  }, [pathname, router]);

  const navigationItems = [
    { name: 'Round Results', path: '/pages/results', id: 'results' },
    { name: 'Enter Team', path: '/pages/team-selection', id: 'team-selection' },
    { name: 'Enter Tips', path: '/pages/tipping', id: 'tipping' },
    { name: 'Season Ladder', path: '/pages/ladder', id: 'ladder' },
    { name: 'Tip Results', path: '/pages/tipping-results', id: 'tipping-results' },
    { name: 'Squads', path: '/pages/squads', id: 'squads' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Banner */}
      <div className="bg-white shadow">
        <div className="w-full p-4 md:p-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-4">
              <div className="flex-shrink-0">
                <Logo width={176} height={176} className="rounded-lg" />
              </div>
              
              {/* Auth placeholder for future implementation */}
              <div className="hidden">
                {/* Authentication UI will go here */}
              </div>
            </div>
            
            {/* Competition Info Bar */}
            <div className="flex flex-wrap gap-4 px-4 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Season:</span>
                <span>{CURRENT_YEAR}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Current Round:</span>
                <span>{roundInfo.currentRoundDisplay}</span>
              </div>
              {roundInfo.lockoutTime && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Round Lockout:</span>
                  <span>{roundInfo.lockoutTime}</span>
                  {roundInfo.isLocked && (
                    <span className="text-red-600">(Locked)</span>
                  )}
                </div>
              )}
              {roundInfo.roundEndTime && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Round Ends:</span>
                  <span>{roundInfo.roundEndTime}</span>
                </div>
              )}
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
  );
}
'use client'

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import logo from '@/app/assets/logo.png';

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

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  
  React.useEffect(() => {
    // Redirect to round-results if we're at the root
    if (pathname === '/') {
      router.push('/pages/results');
    }
  }, [pathname, router]);

  const navigationItems = [
    { name: 'Round Results', path: '/pages/results', id: 'results' },
    { name: 'Team Selection', path: '/pages/team-selection', id: 'team-selection' },
    { name: 'Squads', path: '/pages/squads', id: 'squads' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Banner */}
      <div className="bg-white shadow">
        <div className="w-full p-6">
          <div className="flex items-center px-4">
            <div className="flex-shrink-0">
              <Logo width={176} height={176} className="rounded-lg" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content with Sidebar */}
      <div className="w-full">
        <div className="flex gap-6 p-6">
          {/* Sidebar Navigation */}
          <div className="w-48 flex-shrink-0">
            <div className="bg-white rounded-lg shadow p-4">
              {navigationItems.map((item) => (
                <Link 
                  key={item.id}
                  href={item.path}
                  className={`block px-4 py-2 mb-2 rounded-md transition-colors text-left ${
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

          {/* Main Content Area */}
          <div className="flex-1 bg-white rounded-lg shadow p-6">
            {/* Content will be rendered by the page components */}
          </div>
        </div>
      </div>
    </div>
  );
}
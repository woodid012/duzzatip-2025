'use client'

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Logo from '@/app/components/Logo';
import { getNavigationGroups } from '@/app/lib/navigationConfig';

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  
  React.useEffect(() => {
    // Redirect to round-results if we're at the root
    if (pathname === '/') {
      router.push('/pages/results');
    }
  }, [pathname, router]);

  const navigationGroups = getNavigationGroups();

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
              {navigationGroups.map((group, groupIndex) => (
                <div key={groupIndex}>
                  {group.map((item) => (
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
                  {groupIndex < navigationGroups.length - 1 && (
                    <div className="border-t border-gray-200 my-1"></div>
                  )}
                </div>
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

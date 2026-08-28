'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FinalsAuthProvider, useFinalsAuth } from './context';

// Standalone chrome for the open-registration Duzza Finals mini-app — no
// dependency on the main app's shell/nav. Nests under the root layout
// (fonts/AppProvider) but owns its own header, tabs and auth chip.

const NAV_TABS = [
  { href: '/finals', label: 'Rules' },
  { href: '/finals/enter', label: 'Enter' },
  { href: '/finals/results', label: 'Results' },
  { href: '/finals/ladder', label: 'Ladder' },
];

function AuthChip() {
  const { entrantId, name, source, loading, logout } = useFinalsAuth();

  if (loading) {
    return <div className="h-8 w-24 rounded-full bg-slate-100 animate-pulse" />;
  }

  if (entrantId == null) {
    return (
      <Link href="/finals" className="dz-badge bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="dz-badge bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-[10rem] sm:max-w-xs truncate">
        {source === 'core' && '⭐ '}
        {source === 'admin' && '🛠 '}
        <span className="truncate">{name}</span>
      </span>
      <button
        onClick={logout}
        className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors"
      >
        Log out
      </button>
    </div>
  );
}

function HeaderNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between gap-3 py-3">
          <Link href="/finals" className="flex items-center gap-2 min-w-0">
            <span className="text-xl shrink-0">🏆</span>
            <div className="min-w-0">
              <div className="text-base font-black tracking-tight text-slate-900 leading-none truncate">Duzza Finals</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-600 leading-none mt-0.5">
                AFL Finals 2026
              </div>
            </div>
          </Link>
          <AuthChip />
        </div>
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {NAV_TABS.map((tab) => {
            const active = tab.href === '/finals' ? pathname === '/finals' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-3.5 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  active ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export default function FinalsLayout({ children }) {
  return (
    <FinalsAuthProvider>
      <div className="min-h-screen bg-[hsl(var(--background))]">
        <HeaderNav />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">{children}</main>
      </div>
    </FinalsAuthProvider>
  );
}

'use client'

import { useEffect, useState, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAppContext } from '@/app/context/AppContext';
import Logo from '@/app/components/Logo';
import { getNavigationGroups, debugNavigationItems } from '@/app/lib/navigationConfig';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { ToastProvider } from '@/app/components/Toast';
import RoundStatus from '@/app/components/RoundStatus';
import AuthModal from '@/app/components/AuthModal';
import LoginGate from '@/app/components/LoginGate';
import {
  Menu, X, Trophy, ClipboardList, Target, ListOrdered, TrendingUp,
  CheckCircle2, Shuffle, HeartPulse, Users, Settings, BarChart3,
  RefreshCw, UserCog, Lock, ChevronRight, LogOut, History,
} from 'lucide-react';

// Icon per nav id — keeps the sidebar scannable on web and mobile.
const NAV_ICONS = {
  results: Trophy,
  'team-selection': ClipboardList,
  tipping: Target,
  ladder: ListOrdered,
  'tipping-ladder': TrendingUp,
  'tipping-results': CheckCircle2,
  draft: Shuffle,
  injuries: HeartPulse,
  squads: Users,
  'squad-management': Settings,
  'round-by-round': BarChart3,
  'update-stats': RefreshCw,
  'update-players': UserCog,
  'past-seasons': History,
};

const NavIcon = ({ id, className }) => {
  const Icon = NAV_ICONS[id] || ChevronRight;
  return <Icon className={className} />;
};

// Create context for selected user and admin authentication
export const UserContext = createContext({
  selectedUserId: '',
  setSelectedUserId: () => {},
  isAdminAuthenticated: false,
  authedUserId: null,
  logout: () => {},
  selectedYear: CURRENT_YEAR,
  setSelectedYear: () => {},
  isPastYear: false,
});

// Custom hook to use the user context
export const useUserContext = () => useContext(UserContext);

// Two independent auth switches:
//  • AUTH_RECOGNIZE_LOGIN — honour an existing session: registering signs you
//    in, a returning registered user is auto-resumed into their team and gets a
//    Sign out button. This is ON now so registrations "keep a login".
//  • AUTH_GATING_ENABLED — ENFORCE login when picking a team (password wall +
//    funnel-to-register). This is OFF now, so anyone (registered or not) can
//    still freely choose any team like before. Flip it on in a future step.
const AUTH_RECOGNIZE_LOGIN = true;
const AUTH_GATING_ENABLED = true;

// Pages a not-logged-in visitor may see (everything else requires login).
const PUBLIC_PATHS = ['/pages/results', '/pages/ladder'];


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

  // First-party auth: the user_id the server-verified cookie says we are, plus
  // the create/login modal state for a team that isn't authenticated yet.
  const [authedUserId, setAuthedUserId] = useState(null);
  const [authModal, setAuthModal] = useState(null); // { userId, mode:'login'|'register', error, busy }
  // True once we've checked the session cookie, so route-guarding doesn't fire
  // (and redirect) before we know whether the visitor is logged in.
  const [authReady, setAuthReady] = useState(false);
  // "Skip" on the login gate → browse as a guest (public view) for this session.
  const [guestMode, setGuestMode] = useState(false);

  const enterGuestMode = () => {
    setGuestMode(true);
    if (typeof window !== 'undefined') sessionStorage.setItem('dz_guest', '1');
  };

  // Mobile navigation state
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Year selection state - from AppContext
  const { selectedYear, setSelectedYear, isPastYear } = useAppContext();

  // On load: if login recognition is on, ask the server who the signed cookie
  // says we are. A logged-in (registered) user is remembered — auto-resumed into
  // their team with a Sign out button — even though nothing is gated. If there's
  // no session (or recognition is off), fall back to the original behaviour of
  // restoring the last selection from localStorage, so unregistered users keep
  // picking teams exactly as before.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window !== 'undefined' && sessionStorage.getItem('dz_guest') === '1') {
        setGuestMode(true);
      }
      if (AUTH_RECOGNIZE_LOGIN) {
        try {
          const res = await fetch('/api/auth');
          const data = await res.json();
          if (!cancelled && data.user) {
            if (data.user.admin) {
              setIsAdminAuthenticated(true);
              setSelectedUserId('admin');
            } else {
              setAuthedUserId(data.user.userId);
              setSelectedUserId(String(data.user.userId));
            }
            setAuthReady(true);
            return;
          }
        } catch {
          // ignore — fall through to localStorage restore
        }
      }
      if (!cancelled && typeof window !== 'undefined' && !AUTH_GATING_ENABLED) {
        const saved = localStorage.getItem('selectedUserId');
        if (saved === 'admin') setShowAdminModal(true);
        else if (saved) setSelectedUserId(saved);
      }
      if (!cancelled) setAuthReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Route guard: once we know the session, send not-logged-in visitors away
  // from protected pages to the public results view.
  useEffect(() => {
    if (!AUTH_GATING_ENABLED || !authReady) return;
    const isLoggedIn = isAdminAuthenticated || authedUserId !== null;
    if (!isLoggedIn && pathname?.startsWith('/pages') && !PUBLIC_PATHS.includes(pathname)) {
      router.replace('/pages/results');
    }
  }, [authReady, authedUserId, isAdminAuthenticated, pathname, router]);

  // Save selectedUserId to localStorage when it changes
  useEffect(() => {
    if (selectedUserId && typeof window !== 'undefined') {
      localStorage.setItem('selectedUserId', selectedUserId);
    }
  }, [selectedUserId]);

  // Save selectedYear to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && selectedYear) {
      localStorage.setItem('selectedYear', selectedYear.toString());
    }
  }, [selectedYear]);

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

  // Handle user selection change. Players must authenticate (create a password
  // the first time, then log in) before their team is selected; once a team is
  // authenticated on this device it's selected straight away.
  const handleUserChange = async (e) => {
    const newUserId = e.target.value;

    if (newUserId === 'admin') {
      setShowAdminModal(true);
      return;
    }

    // Gating off: original behaviour — just select the team, no login.
    if (!AUTH_GATING_ENABLED) {
      setSelectedUserId(newUserId);
      setIsAdminAuthenticated(false);
      return;
    }

    if (newUserId === '') {
      setSelectedUserId('');
      return;
    }

    const uid = Number(newUserId);
    setIsAdminAuthenticated(false);

    if (authedUserId === uid) {
      setSelectedUserId(newUserId);
      return;
    }

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', userId: uid }),
      });
      const data = await res.json();
      if (data.authenticated) {
        setAuthedUserId(uid);
        setSelectedUserId(newUserId);
        return;
      }
      // Has an account → log in here; no account yet → funnel to /register.
      setAuthModal({ userId: uid, mode: data.hasPassword ? 'login' : 'register', error: '', busy: false });
    } catch {
      setAuthModal({ userId: uid, mode: 'login', error: 'Could not reach the server', busy: false });
    }
  };

  // Submit the in-app login modal (registration happens on the /register page).
  const submitAuth = async (password) => {
    if (!authModal) return;
    const { userId } = authModal;
    setAuthModal((m) => ({ ...m, busy: true, error: '' }));
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', userId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        // No account yet → switch the modal to point at /register.
        setAuthModal((m) => ({
          ...m,
          busy: false,
          error: data.error || 'Something went wrong',
          mode: data.needsRegister ? 'register' : m.mode,
        }));
        return;
      }
      setAuthedUserId(userId);
      setSelectedUserId(String(userId));
      setAuthModal(null);
    } catch {
      setAuthModal((m) => ({ ...m, busy: false, error: 'Could not reach the server' }));
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch {
      // ignore — clear locally regardless
    }
    setAuthedUserId(null);
    setSelectedUserId('');
    setIsAdminAuthenticated(false);
    setGuestMode(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('selectedUserId');
      sessionStorage.removeItem('dz_guest');
    }
  };

  // Handle admin password submission — server-verified so admin also gets a
  // signed session cookie that bypasses the server-side privacy filters.
  const handleAdminPasswordSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-login', password: adminPassword }),
      });
      if (res.ok) {
        setIsAdminAuthenticated(true);
        setSelectedUserId('admin');
        setShowAdminModal(false);
        setAdminPassword('');
      } else {
        alert('Incorrect password');
      }
    } catch {
      alert('Could not reach the server');
    }
  };

  const navigationGroups = getNavigationGroups(true); // Include Squad Management

  // Not-logged-in visitors only get the public pages in the nav.
  const isLoggedIn = isAdminAuthenticated || authedUserId !== null;
  const visibleGroups = (!AUTH_GATING_ENABLED || isLoggedIn)
    ? navigationGroups
    : navigationGroups
        .map((group) => group.filter((item) => PUBLIC_PATHS.includes(item.path)))
        .filter((group) => group.length > 0);

  // Get current page name for mobile header
  const currentPageName = navigationGroups
    .flat()
    .concat(debugNavigationItems)
    .find(item => item.path === pathname)?.name || '';

  // Check if the current page should show only the selected user's team
  const isSingleUserPage = pathname === '/pages/team-selection' || pathname === '/pages/tipping';

  // Determine if we should show round info yet
  const showRoundInfo = !loading.fixtures && roundInfo && roundInfo.currentRound !== undefined;

  // Once a round is locked, show its status (In Progress / Complete / Locked)
  // in the header's Lockout indicator — that's where it lives now that the
  // banner is just a "tips & teams due" reminder for open rounds.
  const roundStatus = roundInfo?.isLocked
    ? (roundInfo.roundEndDate
        ? (Date.now() >= new Date(roundInfo.roundEndDate).getTime() ? 'Complete' : 'In Progress')
        : 'Locked')
    : null;
  const roundStatusCls = roundStatus === 'In Progress'
    ? 'bg-blue-100 text-blue-700'
    : roundStatus === 'Complete'
      ? 'bg-slate-100 text-slate-600'
      : 'bg-red-100 text-red-700';

  // Shared bits ----------------------------------------------------------

  const UserSelect = ({ className = '' }) => {
    // Once signed in, the team is locked — sign out to switch.
    const locked = authedUserId !== null || isAdminAuthenticated;
    return (
      <select
        value={selectedUserId}
        onChange={handleUserChange}
        disabled={locked}
        title={locked ? 'Signed in — sign out to switch teams' : undefined}
        className={`dz-select ${locked ? 'cursor-default appearance-none pr-3' : ''} ${className}`}
      >
        <option value="">Select Player</option>
        {Object.entries(USER_NAMES).map(([id, name]) => (
          <option key={id} value={id}>{name}</option>
        ))}
        <option value="admin">Admin</option>
      </select>
    );
  };

  const NavLink = ({ item, onClick }) => {
    const active = pathname === item.path;
    return (
      <Link
        key={item.id}
        href={item.path}
        onClick={onClick}
        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
          active
            ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <NavIcon
          id={item.id}
          className={`h-[18px] w-[18px] flex-shrink-0 ${active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`}
        />
        <span className="truncate">{item.name}</span>
      </Link>
    );
  };

  // While the session cookie is being checked, show a brief splash so the app
  // doesn't flash the public view first and then re-render — one screen, not two.
  if (AUTH_GATING_ENABLED && !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Logo width={56} height={56} className="rounded-2xl" />
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
        </div>
      </div>
    );
  }

  // Not logged in and not browsing as a guest → prompt to sign in (with Skip).
  if (AUTH_GATING_ENABLED && !isLoggedIn && !guestMode) {
    return (
      <LoginGate
        onLoggedIn={(uid) => { setAuthedUserId(uid); setSelectedUserId(String(uid)); }}
        onAdmin={() => { setIsAdminAuthenticated(true); setSelectedUserId('admin'); }}
        onSkip={enterGuestMode}
      />
    );
  }

  return (
    <ToastProvider>
    <UserContext.Provider value={{
      selectedUserId,
      setSelectedUserId,
      isAdminAuthenticated,
      setIsAdminAuthenticated,
      authedUserId,
      logout: handleLogout,
      selectedYear,
      setSelectedYear,
      isPastYear,
    }}>
      <div className="min-h-screen bg-background">
        {/* Player login modal (only when gating is enabled) */}
        {AUTH_GATING_ENABLED && authModal && (
          <AuthModal
            userName={USER_NAMES[authModal.userId]}
            userId={authModal.userId}
            mode={authModal.mode}
            error={authModal.error}
            busy={authModal.busy}
            onSubmit={submitAuth}
            onCancel={() => setAuthModal(null)}
          />
        )}

        {/* Admin Password Modal */}
        {showAdminModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-fade-in">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Lock className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Admin Authentication</h3>
              </div>
              <form onSubmit={handleAdminPasswordSubmit}>
                <div className="mb-4">
                  <label htmlFor="adminPassword" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Admin Password
                  </label>
                  <input
                    type="password"
                    id="adminPassword"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="dz-select w-full"
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
                      if (typeof window !== 'undefined') {
                        const savedUserId = localStorage.getItem('selectedUserId');
                        if (savedUserId && savedUserId !== 'admin') {
                          setSelectedUserId(savedUserId);
                        } else {
                          setSelectedUserId('');
                        }
                      }
                    }}
                    className="dz-btn-ghost"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="dz-btn-primary">Login</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ===================== Mobile Header ===================== */}
        <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur-md md:hidden">
          <div className="flex items-center justify-between gap-2 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                aria-label="Open navigation"
              >
                <Menu className="h-6 w-6" />
              </button>
              <span className="truncate text-sm font-semibold text-slate-900">
                {currentPageName || 'DuzzaTip'}
              </span>
            </div>

            <div className="flex flex-col items-end gap-1">
              <UserSelect className="w-40 py-1.5 text-sm" />
              <div className="flex items-center gap-2">
                {(authedUserId !== null || isAdminAuthenticated) && (
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                )}
              </div>
            </div>
          </div>

          {selectedUserId === 'admin' && isAdminAuthenticated && (
            <div className="px-3 pb-2">
              <span className="dz-badge bg-amber-100 text-amber-700">Admin Mode</span>
            </div>
          )}

          {/* Past year banner - mobile */}
          {isPastYear && (
            <div className="flex items-center justify-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-xs font-medium text-amber-800">
              <span>Viewing {selectedYear} (read-only)</span>
              <button onClick={() => setSelectedYear(CURRENT_YEAR)} className="font-semibold text-blue-600 underline">
                Back to {CURRENT_YEAR}
              </button>
            </div>
          )}

          {/* Mobile round info — hidden on results, where the scoreboard header
              (season + round + live) already shows it */}
          {showRoundInfo && !isPastYear && pathname !== '/pages/results' && (
            <div className="space-y-1 border-t border-slate-100 bg-slate-50/70 px-3 pb-3 pt-2 text-xs text-slate-600">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Season {CURRENT_YEAR}</span>
                <span className="font-semibold text-slate-900">{roundInfo.currentRoundDisplay}</span>
              </div>
              {roundInfo.lockoutTime && (
                <div className="flex items-center justify-between">
                  <span>Lockout:</span>
                  <div>
                    <span className="font-medium text-slate-900">{roundInfo.lockoutTime}</span>
                    {roundStatus && (
                      <span className={`ml-1 font-semibold ${
                        roundStatus === 'In Progress' ? 'text-blue-600' : roundStatus === 'Complete' ? 'text-slate-500' : 'text-red-600'
                      }`}>({roundStatus})</span>
                    )}
                  </div>
                </div>
              )}
              {roundInfo.roundEndTime && (
                <div className="flex items-center justify-between">
                  <span>Ends:</span>
                  <span className="font-medium text-slate-900">{roundInfo.roundEndTime}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ===================== Mobile Nav Drawer ===================== */}
        {isMobileNavOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setIsMobileNavOpen(false)}>
            <div
              className="animate-slide-in-left absolute left-0 top-0 h-full w-80 max-w-[85%] bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <div className="flex items-center gap-2">
                  <Logo width={36} height={36} className="rounded-lg" />
                  <h2 className="text-lg font-bold text-slate-900">DuzzaTip</h2>
                </div>
                <button
                  onClick={() => setIsMobileNavOpen(false)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Close navigation"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="space-y-1 overflow-y-auto p-3" style={{ maxHeight: 'calc(100vh - 73px)' }}>
                {visibleGroups.map((group, groupIndex) => (
                  <div key={groupIndex} className="space-y-1">
                    {group.map((item) => (
                      <NavLink key={item.id} item={item} onClick={() => setIsMobileNavOpen(false)} />
                    ))}
                    {groupIndex < navigationGroups.length - 1 && (
                      <div className="my-2 border-t border-slate-100" />
                    )}
                  </div>
                ))}
                {selectedUserId === 'admin' && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Debug</p>
                    {debugNavigationItems.map((item) => (
                      <NavLink key={item.id} item={item} onClick={() => setIsMobileNavOpen(false)} />
                    ))}
                  </div>
                )}
              </nav>
            </div>
          </div>
        )}

        {/* ===================== Desktop Header ===================== */}
        <header className="sticky top-0 z-30 hidden border-b border-slate-200 bg-white/85 backdrop-blur-md md:block">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-3">
            <div className="flex items-center gap-4">
              <Logo width={48} height={48} className="rounded-xl" />
              <div className="leading-tight">
                <div className="text-lg font-bold tracking-tight text-slate-900">DuzzaTip</div>
                <div className="text-xs text-slate-500">AFL Fantasy Tipping</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm">
              {isPastYear && (
                <div className="flex items-center gap-2">
                  <span className="dz-badge bg-amber-100 text-amber-700">Viewing {selectedYear} · read-only</span>
                  <button onClick={() => setSelectedYear(CURRENT_YEAR)} className="text-xs font-semibold text-blue-600 hover:underline">
                    Back to {CURRENT_YEAR}
                  </button>
                </div>
              )}

              {!isPastYear && (showRoundInfo ? (
                <div className="hidden items-center gap-2 lg:flex">
                  <span className="text-slate-500">Round</span>
                  <span className="font-semibold text-slate-900">{roundInfo.currentRoundDisplay}</span>
                </div>
              ) : (
                <div className="hidden items-center gap-2 lg:flex">
                  <span className="text-slate-500">Round</span>
                  <span className="animate-pulse text-slate-400">Loading…</span>
                </div>
              ))}

              {!isPastYear && showRoundInfo && roundInfo.lockoutTime && (
                <div className="hidden items-center gap-1.5 xl:flex">
                  <span className="text-slate-500">Lockout</span>
                  <span className="font-medium text-slate-900">{roundInfo.lockoutTime}</span>
                  {roundStatus && (
                    <span className={`dz-badge ${roundStatusCls}`}>{roundStatus}</span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <UserSelect className="w-44" />
                {selectedUserId === 'admin' && isAdminAuthenticated && (
                  <span className="dz-badge bg-amber-100 text-amber-700">Admin</span>
                )}
                {(authedUserId !== null || isAdminAuthenticated) && (
                  <button
                    onClick={handleLogout}
                    title="Sign out"
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="hidden xl:inline">Sign out</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Tips & teams due reminder (only shows while the round is open) */}
        <RoundStatus />

        {/* ===================== Main Content ===================== */}
        <div className="mx-auto w-full max-w-[1400px]">
          {/* Desktop Layout with Sidebar */}
          <div className="hidden gap-6 p-6 md:flex">
            <aside className="w-56 flex-shrink-0">
              <div className="sticky top-[88px]">
                <nav className="dz-surface space-y-1 p-3">
                  {visibleGroups.map((group, groupIndex) => (
                    <div key={groupIndex} className="space-y-1">
                      {group.map((item) => (
                        <NavLink key={item.id} item={item} />
                      ))}
                      {groupIndex < navigationGroups.length - 1 && (
                        <div className="my-2 border-t border-slate-100" />
                      )}
                    </div>
                  ))}
                  {selectedUserId === 'admin' && (
                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Debug</p>
                      {debugNavigationItems.map((item) => (
                        <NavLink key={item.id} item={item} />
                      ))}
                    </div>
                  )}
                </nav>
              </div>
            </aside>

            <main className="min-w-0 flex-1 animate-fade-in">
              {selectedUserId === 'admin' && !isAdminAuthenticated ? (
                <div className="dz-surface p-8 text-center">
                  <h2 className="mb-4 text-xl font-bold">Admin Authentication Required</h2>
                  <p className="mb-4 text-slate-600">You need to authenticate as an admin to view this content.</p>
                  <button onClick={() => setShowAdminModal(true)} className="dz-btn-primary mx-auto">
                    Authenticate
                  </button>
                </div>
              ) : (
                children
              )}
            </main>
          </div>

          {/* Mobile Layout - Full Width Content (pages provide their own cards) */}
          <div className="md:hidden">
            {selectedUserId === 'admin' && !isAdminAuthenticated ? (
              <div className="m-3 dz-surface p-6 text-center">
                <h2 className="mb-4 text-xl font-bold">Admin Authentication Required</h2>
                <p className="mb-4 text-slate-600">You need to authenticate as an admin to view this content.</p>
                <button onClick={() => setShowAdminModal(true)} className="dz-btn-primary mx-auto">
                  Authenticate
                </button>
              </div>
            ) : (
              <div className="animate-fade-in">{children}</div>
            )}
          </div>
        </div>
      </div>
    </UserContext.Provider>
    </ToastProvider>
  );
}

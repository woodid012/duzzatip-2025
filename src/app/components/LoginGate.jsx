'use client';

import { useState } from 'react';
import Link from 'next/link';
import Logo from '@/app/components/Logo';
import { USER_NAMES } from '@/app/lib/constants';

// First-visit login prompt for not-logged-in users. Pick a team → enter
// password → signed in. "Skip" browses as a guest (public view). New users are
// pointed at /register.
export default function LoginGate({ onLoggedIn, onAdmin, onSkip }) {
  const [userId, setUserId] = useState('');
  const [hasPassword, setHasPassword] = useState(null); // null = not chosen yet
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = userId === 'admin';
  const uid = Number(userId);
  const teamName = isAdmin ? 'Admin' : USER_NAMES[uid];

  const onTeam = async (e) => {
    const v = e.target.value;
    setUserId(v);
    setPassword('');
    setError('');
    setHasPassword(null);
    if (!v) return;
    if (v === 'admin') { setHasPassword(true); return; } // admin always needs its password
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', userId: Number(v) }),
      });
      const d = await r.json();
      if (d.authenticated) { onLoggedIn(Number(v)); return; }
      setHasPassword(Boolean(d.hasPassword));
    } catch {
      setError('Could not reach the server');
    }
  };

  const signIn = async (e) => {
    e.preventDefault();
    if (!teamName || !password) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isAdmin ? { action: 'admin-login', password } : { action: 'login', userId: uid, password }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Sign in failed'); setBusy(false); return; }
      if (isAdmin) onAdmin(); else onLoggedIn(uid);
    } catch {
      setError('Could not reach the server');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo width={64} height={64} className="rounded-2xl" />
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Welcome to DuzzaTip</h1>
          <p className="text-sm text-slate-500">Sign in to manage your team &amp; tips.</p>
        </div>

        <div className="dz-surface p-6">
          <form onSubmit={signIn} className="space-y-4">
            <div>
              <label htmlFor="gate-team" className="mb-1.5 block text-sm font-medium text-slate-700">Your team</label>
              <select id="gate-team" value={userId} onChange={onTeam} className="dz-select w-full">
                <option value="">Select your team…</option>
                {Object.entries(USER_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
                <option value="admin">Admin</option>
              </select>
            </div>

            {teamName && hasPassword && (
              <div>
                <label htmlFor="gate-pw" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
                <input
                  id="gate-pw"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="dz-select w-full"
                  placeholder="Enter your password"
                />
              </div>
            )}

            {teamName && hasPassword === false && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-sm text-slate-700">
                No account for {teamName} yet.{' '}
                <Link href={`/register?team=${uid}`} className="font-semibold text-blue-600 hover:underline">Register here</Link>.
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {teamName && hasPassword && (
              <button type="submit" disabled={busy || !password} className="dz-btn-primary w-full">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            )}
          </form>

          <div className="mt-4 flex items-center justify-between text-sm">
            <Link href="/register" className="font-medium text-blue-600 hover:underline">New here? Register</Link>
            <button onClick={onSkip} className="font-medium text-slate-500 hover:text-slate-700">Skip — just browse →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

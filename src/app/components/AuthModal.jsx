'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock, UserPlus } from 'lucide-react';

// Shown when a user picks a team that isn't already authenticated on this device.
//   mode 'login'    → that team has an account → ask for the password
//   mode 'register' → no account yet → point them at /register
export default function AuthModal({ userName, userId, mode, error, busy, onSubmit, onCancel }) {
  const [password, setPassword] = useState('');

  if (mode === 'register') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-fade-in">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <UserPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-900">Set up your account</h3>
              <p className="truncate text-sm text-slate-500">{userName}</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            This team doesn&apos;t have an account yet. Create one — pick your team, add your number and choose a password — to get started.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="dz-btn-ghost">Cancel</button>
            <Link href={`/register?team=${userId}`} className="dz-btn-primary">Go to register</Link>
          </div>
        </div>
      </div>
    );
  }

  // mode 'login'
  const canSubmit = password.length >= 1 && !busy;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Lock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-900">Welcome back</h3>
            <p className="truncate text-sm text-slate-500">{userName}</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSubmit(password);
          }}
        >
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="dz-select w-full"
            placeholder="Enter your password"
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="dz-btn-ghost">Cancel</button>
            <button type="submit" disabled={!canSubmit} className="dz-btn-primary">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>

        <p className="mt-3 text-xs text-slate-400">
          No account yet?{' '}
          <Link href={`/register?team=${userId}`} className="font-medium text-blue-600 hover:underline">
            Register here
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

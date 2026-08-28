'use client';

import { useState } from 'react';
import { useFinalsAuth } from '../context';

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30';

// Register + Login, tabbed, sharing one card. Contract:
//   POST {action:'register', name, email, password} — email required, no
//     verification, instant access.
//   POST {action:'login', name, password} — name accepts team name OR email.
export default function AuthForms() {
  const { register, login, prefillName } = useFinalsAuth();
  const [tab, setTab] = useState('register'); // 'register' | 'login'

  return (
    <div className="dz-surface p-5 sm:p-6 max-w-md mx-auto">
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {[
          { id: 'register', label: 'Register a team' },
          { id: 'login', label: 'Log in' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'register'
        ? <RegisterForm onSuccess={() => {}} />
        : <LoginForm onSuccess={() => {}} prefillName={prefillName} />}
    </div>
  );
}

function RegisterForm() {
  const { register } = useFinalsAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = name.trim().length >= 3 && email.trim().length > 0 && password.length >= 4 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await register({ name: name.trim(), email: email.trim(), password });
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Team name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. The Border Collie Herders"
          maxLength={40}
          className={inputClass}
        />
        <p className="mt-1 text-[11px] text-slate-400">3–40 characters. Shown on the ladder and around the grounds.</p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Pick a simple password"
          className={inputClass}
        />
        <p className="mt-1 text-[11px] text-slate-400">At least 4 characters — you&apos;ll use it to log back in.</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 p-2.5 text-xs font-medium">{error}</div>
      )}

      <button type="submit" disabled={!canSubmit} className="dz-btn-primary w-full">
        {busy ? 'Registering…' : "Register & I'm in"}
      </button>
    </form>
  );
}

function LoginForm({ prefillName }) {
  const { login } = useFinalsAuth();
  const [name, setName] = useState(prefillName || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = name.trim().length > 0 && password.length > 0 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await login({ name: name.trim(), password });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Team name or email</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Team name or email"
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          className={inputClass}
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 p-2.5 text-xs font-medium">{error}</div>
      )}

      <button type="submit" disabled={!canSubmit} className="dz-btn-primary w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

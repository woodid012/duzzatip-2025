'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/app/components/Logo';
import { USER_NAMES } from '@/app/lib/constants';
import { UserCheck, Lock, CheckCircle2, ArrowLeft } from 'lucide-react';

// Standalone onboarding page (no app shell). Flow:
//   1. Select your team (default none)
//   2. Confirm "this is your team"
//   3. Set a password, confirm it (twice) → account created + signed in
export default function RegisterPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [confirmedTeam, setConfirmedTeam] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [registered, setRegistered] = useState([]);

  // Prefill the team from ?team=<id> if the link carried one.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('team');
    if (t && USER_NAMES[Number(t)]) setUserId(String(Number(t)));
  }, []);

  // Load which teams already have an account so we can hide them.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth?registered=1')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRegistered(Array.isArray(d.registered) ? d.registered : []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // If a prefilled / chosen team turns out to be already registered, clear it.
  useEffect(() => {
    if (userId && registered.includes(Number(userId))) {
      setUserId('');
      setConfirmedTeam(false);
    }
  }, [registered, userId]);

  const availableTeams = Object.entries(USER_NAMES).filter(
    ([id]) => !registered.includes(Number(id))
  );

  const uid = Number(userId);
  const teamName = USER_NAMES[uid];
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length >= 8;
  // Email is optional; only validate format when something is entered.
  const emailOk = email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    Boolean(teamName) && confirmedTeam && phoneOk && emailOk &&
    password.length >= 4 && password === confirm && !busy;

  const handleTeamChange = (e) => {
    setUserId(e.target.value);
    setConfirmedTeam(false);
    setPhone('');
    setEmail('');
    setPassword('');
    setConfirm('');
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          userId: uid,
          password,
          phone: phone.trim(),
          email: email.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not create your account');
        setBusy(false);
        return;
      }
      setDone(true); // cookie is now set — they're signed in
      setTimeout(() => router.push('/pages/results'), 1300);
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
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Set up your account</h1>
          <p className="text-sm text-slate-500">Pick your team and choose a password — you&apos;ll stay signed in on this device.</p>
        </div>

        <div className="dz-surface p-6">
          {done ? (
            <div className="flex flex-col items-center py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <h2 className="mt-3 text-lg font-bold text-slate-900">You&apos;re all set</h2>
              <p className="mt-1 text-base font-semibold text-slate-900">{teamName}</p>
              <p className="text-sm text-slate-500">{phone.trim()}</p>
              <p className="mt-2 text-sm text-slate-500">Taking you in…</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              {/* Step 1 — team */}
              <div>
                <label htmlFor="team" className="mb-1.5 block text-sm font-medium text-slate-700">
                  1. Select your team
                </label>
                <select id="team" value={userId} onChange={handleTeamChange} className="dz-select w-full">
                  <option value="">Select your team…</option>
                  {availableTeams.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
                {availableTeams.length === 0 && (
                  <p className="mt-2 text-sm text-slate-500">
                    Every team is already registered.{' '}
                    <Link href="/pages/results" className="font-medium text-blue-600 hover:underline">
                      Go to the app
                    </Link>
                    .
                  </p>
                )}
              </div>

              {/* Step 2 — confirm team */}
              {teamName && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">2. Confirm your team</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{teamName}</p>
                  {!confirmedTeam ? (
                    <button
                      type="button"
                      onClick={() => setConfirmedTeam(true)}
                      className="dz-btn-primary mt-3 w-full"
                    >
                      <UserCheck className="h-4 w-4" /> Yes, this is my team
                    </button>
                  ) : (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" /> Confirmed
                    </p>
                  )}
                </div>
              )}

              {/* Step 3 — phone number */}
              {teamName && confirmedTeam && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-700">
                      3. Mobile number
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      autoFocus
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="dz-select w-full"
                      placeholder="e.g. 0412 345 678"
                    />
                    {phone.length > 0 && !phoneOk && (
                      <p className="mt-1 text-xs text-red-600">Enter a valid mobile number</p>
                    )}
                  </div>

                  {/* Optional email */}
                  <div>
                    <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Email <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      id="email"
                      type="email"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="dz-select w-full"
                      placeholder="you@example.com"
                    />
                    {!emailOk && (
                      <p className="mt-1 text-xs text-red-600">Enter a valid email, or leave it blank</p>
                    )}
                  </div>

                  {/* Step 4 — password (twice) */}
                  <div>
                    <label htmlFor="pw" className="mb-1.5 block text-sm font-medium text-slate-700">
                      4. Choose a password
                    </label>
                    <input
                      id="pw"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="dz-select w-full"
                      placeholder="At least 4 characters"
                    />
                  </div>
                  <div>
                    <label htmlFor="pw2" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Confirm password
                    </label>
                    <input
                      id="pw2"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="dz-select w-full"
                      placeholder="Re-enter your password"
                    />
                  </div>
                  {mismatch && <p className="text-sm text-red-600">Passwords don&apos;t match</p>}

                  {/* Review: team name + phone */}
                  {phoneOk && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-sm">
                      <p className="font-semibold text-slate-900">{teamName}</p>
                      <p className="text-slate-600">{phone.trim()}</p>
                      {email.trim() && emailOk && <p className="text-slate-600">{email.trim()}</p>}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                  {/already has an account|already set/i.test(error) && (
                    <>
                      {' '}
                      <Link href="/pages/results" className="font-semibold underline">
                        Go to the app to sign in
                      </Link>
                      .
                    </>
                  )}
                </div>
              )}

              <button type="submit" disabled={!canSubmit} className="dz-btn-primary w-full">
                {busy ? 'Creating your account…' : 'Create account & sign in'}
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 text-center">
          <Link href="/pages/results" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" /> Already set up? Go to the app
          </Link>
        </div>
      </div>
    </div>
  );
}

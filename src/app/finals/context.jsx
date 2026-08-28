'use client';

// Self-contained auth context for the standalone Duzza Finals app. Talks
// only to /api/duzza-finals/auth — entirely separate from the main app's
// AppContext/session. GET on mount resolves whoami (finals cookie, or a
// recognised main-app session for core/admin); register/login/logout POST
// the corresponding actions and keep local state in sync.
//
// Belt-and-braces "sign in once per device": the session cookie already
// lasts a year, but as an extra local fallback we also cache {name,
// password} in localStorage on a successful register/login. If whoami comes
// back signed-out, we silently retry a login with those saved creds before
// ever showing the forms — only a second failure (wrong/changed password,
// deleted entrant, etc.) falls through to the forms, prefilled with the
// saved team name. The user has explicitly said security isn't a concern
// here, hence storing the raw password client-side.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchJSON, postJSON } from './lib/api';

const FinalsAuthContext = createContext(null);

const CREDS_KEY = 'dzf_creds';

function loadCreds() {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.name && parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

function saveCreds(name, password) {
  try {
    localStorage.setItem(CREDS_KEY, JSON.stringify({ name, password }));
  } catch {
    // localStorage unavailable (private mode, blocked site data, etc.) — the
    // year-long session cookie is still the primary mechanism, this is only
    // a belt-and-braces extra.
  }
}

function clearCreds() {
  try {
    localStorage.removeItem(CREDS_KEY);
  } catch {
    // ignore
  }
}

export function FinalsAuthProvider({ children }) {
  const [entrantId, setEntrantId] = useState(null);
  const [name, setName] = useState(null);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Populated whenever a saved-creds silent login is attempted, so the
  // register/login forms can prefill the team-name field even after that
  // attempt fails.
  const [prefillName, setPrefillName] = useState('');

  const applySignedIn = useCallback((data) => {
    setEntrantId(data.entrantId);
    setName(data.name || null);
    setSource(data.source || 'invited');
  }, []);

  const applySignedOut = useCallback(() => {
    setEntrantId(null);
    setName(null);
    setSource(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJSON('/api/duzza-finals/auth');
      if (data && data.entrantId != null) {
        applySignedIn(data);
        return;
      }

      // Not signed in via cookie — try the saved-creds fallback once before
      // giving up and showing the forms.
      const creds = loadCreds();
      if (creds) {
        setPrefillName(creds.name);
        try {
          const loginData = await postJSON('/api/duzza-finals/auth', {
            action: 'login',
            name: creds.name,
            password: creds.password,
          });
          applySignedIn({ ...loginData, source: 'invited' });
          return;
        } catch {
          // Saved creds no longer work — fall through to signed-out; the
          // forms will show with the team name prefilled from prefillName.
        }
      }

      applySignedOut();
    } catch (err) {
      setError(err.message);
      applySignedOut();
    } finally {
      setLoading(false);
    }
  }, [applySignedIn, applySignedOut]);

  useEffect(() => { refresh(); }, [refresh]);

  const register = useCallback(async ({ name: teamName, email, password }) => {
    const data = await postJSON('/api/duzza-finals/auth', {
      action: 'register',
      name: teamName,
      email,
      password,
    });
    applySignedIn({ ...data, source: 'invited' });
    saveCreds(data.name || teamName, password);
    return data;
  }, [applySignedIn]);

  const login = useCallback(async ({ name: teamName, password }) => {
    const data = await postJSON('/api/duzza-finals/auth', {
      action: 'login',
      name: teamName,
      password,
    });
    applySignedIn({ ...data, source: 'invited' });
    saveCreds(data.name || teamName, password);
    return data;
  }, [applySignedIn]);

  const logout = useCallback(async () => {
    try {
      await postJSON('/api/duzza-finals/auth', { action: 'logout' });
    } catch {
      // still clear local state even if the request fails
    }
    clearCreds();
    setPrefillName('');
    applySignedOut();
  }, [applySignedOut]);

  return (
    <FinalsAuthContext.Provider
      value={{ entrantId, name, source, loading, error, prefillName, refresh, register, login, logout }}
    >
      {children}
    </FinalsAuthContext.Provider>
  );
}

export function useFinalsAuth() {
  const ctx = useContext(FinalsAuthContext);
  if (!ctx) throw new Error('useFinalsAuth must be used within FinalsAuthProvider');
  return ctx;
}

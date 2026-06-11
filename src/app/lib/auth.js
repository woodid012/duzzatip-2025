// src/app/lib/auth.js
// First-party auth helpers — DB + signed httpOnly cookie, no external deps.
// Password hashing uses Node's built-in scrypt; the session cookie is a
// stateless HMAC-signed token (uid + expiry). Server-only (imports node:crypto).
import crypto from 'crypto';

// Set AUTH_SECRET in the environment (Vercel project settings + .env.local).
// The fallback exists only so local dev works out of the box; in production an
// unset secret means every restart still verifies, but anyone who knows this
// string could forge a session — so DO set AUTH_SECRET for the deployed app.
const SECRET =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  'duzzatip-insecure-dev-secret-please-set-AUTH_SECRET';

export const AUTH_COOKIE = 'dz_session';
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year — "sign in once"
export const SESSION_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

// Admin sessions use a sentinel uid (0) — no real team is id 0. The admin
// password is server-verified (was client-only) so admin can also bypass the
// server-side privacy filters.
export const ADMIN_UID = 0;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Duz';

export function checkAdminPassword(password) {
  return String(password || '') === ADMIN_PASSWORD;
}

// Read the signed session from a request (works with NextRequest.cookies).
// Returns { uid } for a player, { uid: 0 } for admin, or null.
export function getSessionUser(request) {
  const token = request.cookies?.get?.(AUTH_COOKIE)?.value;
  return verifySession(token);
}

// ── Password hashing (scrypt) ───────────────────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Session token (HMAC-signed, stateless) ──────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sign(payload) {
  return b64url(crypto.createHmac('sha256', SECRET).update(payload).digest());
}

export function signSession(userId, ttlMs = SESSION_TTL_MS) {
  const payload = b64url(JSON.stringify({ uid: Number(userId), exp: Date.now() + ttlMs }));
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const data = JSON.parse(json);
    if (!data || typeof data.uid !== 'number' || !data.exp || Date.now() > data.exp) return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}

// Cookie options shared by login/register/logout.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

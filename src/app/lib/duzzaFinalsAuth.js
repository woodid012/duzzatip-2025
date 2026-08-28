// src/app/lib/duzzaFinalsAuth.js
// Duzza Finals — lightweight auth for open-registration "invited" entrants.
// Deliberately separate from src/app/lib/auth.js (the core-8/admin main-app
// session) — different cookie, different collection, no notion of team ids —
// but mirrors its cryptographic patterns exactly: scrypt pin hashing in the
// same `scrypt$salt$hash` format, and a stateless HMAC-SHA256 signed cookie
// token in the same `payload.sig` shape. Same secret env var as the main
// app; there's no reason to manage a second secret for a sibling scheme.
import crypto from 'crypto';

const SECRET =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  'duzzatip-insecure-dev-secret-please-set-AUTH_SECRET';

export const FINALS_AUTH_COOKIE = 'dz_finals_session';
const FINALS_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year — "sign in once"
export const FINALS_SESSION_MAX_AGE = Math.floor(FINALS_SESSION_TTL_MS / 1000);

// ── Pin hashing (scrypt) — identical format to auth.js's password hashing ──
export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPin(pin, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Session token (HMAC-signed, stateless) — same shape as
// signSession/verifySession in auth.js, just carrying entrantId instead of uid.
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

export function signFinalsSession(entrantId, ttlMs = FINALS_SESSION_TTL_MS) {
  const payload = b64url(JSON.stringify({ entrantId: Number(entrantId), exp: Date.now() + ttlMs }));
  return `${payload}.${sign(payload)}`;
}

export function verifyFinalsSession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const data = JSON.parse(json);
    if (!data || typeof data.entrantId !== 'number' || !data.exp || Date.now() > data.exp) return null;
    return { entrantId: data.entrantId };
  } catch {
    return null;
  }
}

// Read the signed finals session from a request (works with NextRequest.cookies,
// same access pattern as getSessionUser in auth.js). Returns {entrantId} | null.
export function getFinalsSessionEntrant(request) {
  const token = request.cookies?.get?.(FINALS_AUTH_COOKIE)?.value;
  return verifyFinalsSession(token);
}

// ── Cookie serialization ────────────────────────────────────────────────────
// Raw `Set-Cookie` header strings rather than a cookies.set()-style helper —
// callers append these directly onto a Response/NextResponse's headers, which
// keeps this module framework-agnostic (no next/server import needed here).
function serializeCookie(name, value, { maxAge, secure } = {}) {
  const parts = [`${name}=${value}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function createFinalsSessionCookie(entrantId) {
  const token = signFinalsSession(entrantId);
  return serializeCookie(FINALS_AUTH_COOKIE, token, {
    maxAge: FINALS_SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
}

export function clearFinalsSessionCookie() {
  return serializeCookie(FINALS_AUTH_COOKIE, '', {
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  });
}

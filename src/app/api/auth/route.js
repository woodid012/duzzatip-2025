// src/app/api/auth/route.js
// First-party auth: one route, several actions, DB + signed httpOnly cookie.
//   GET                      → "me": who the cookie says I am (or null)
//   POST { action:'status' } → does this team have a password? am I it?
//   POST { action:'register'}→ set password for a team (first time) + sign in
//   POST { action:'login'   }→ verify password + sign in
//   POST { action:'logout'  }→ clear the session cookie
// Auth is NOT year-scoped — a player's password persists across seasons — so it
// lives in a plain `user_auth` collection (no year prefix).
import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';
import { USER_NAMES } from '@/app/lib/constants';
import {
  AUTH_COOKIE,
  ADMIN_UID,
  checkAdminPassword,
  hashPassword,
  verifyPassword,
  signSession,
  getSessionUser,
  sessionCookieOptions,
} from '@/app/lib/auth';

const COLLECTION = 'user_auth';

function sessionFromRequest(request) {
  return getSessionUser(request); // { uid } | null  (uid 0 = admin)
}

function isValidTeam(uid) {
  return Number.isInteger(uid) && Boolean(USER_NAMES[uid]);
}

// GET — "me", or the list of already-registered teams (?registered=1)
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get('registered')) {
    try {
      const { db } = await connectToDatabase();
      const recs = await db
        .collection(COLLECTION)
        .find({ passwordHash: { $exists: true, $ne: null } }, { projection: { user_id: 1 } })
        .toArray();
      return NextResponse.json({ registered: recs.map((r) => r.user_id) });
    } catch (error) {
      console.error('Auth registered-list error:', error);
      return NextResponse.json({ registered: [] });
    }
  }

  const sess = sessionFromRequest(request);
  if (sess && sess.uid === ADMIN_UID) {
    return NextResponse.json({ user: { userId: ADMIN_UID, userName: 'Admin', admin: true } });
  }
  if (!sess || !isValidTeam(sess.uid)) {
    return NextResponse.json({ user: null });
  }
  return NextResponse.json({
    user: { userId: sess.uid, userName: USER_NAMES[sess.uid] },
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { action } = body || {};
  const uid = Number(body?.userId);
  const password = body?.password;

  try {
    const { db } = await connectToDatabase();
    const col = db.collection(COLLECTION);

    if (action === 'status') {
      if (!isValidTeam(uid)) return NextResponse.json({ error: 'Unknown team' }, { status: 400 });
      const rec = await col.findOne({ user_id: uid }, { projection: { passwordHash: 1 } });
      const sess = sessionFromRequest(request);
      return NextResponse.json({
        hasPassword: Boolean(rec?.passwordHash),
        authenticated: sess?.uid === uid,
      });
    }

    if (action === 'register') {
      if (!isValidTeam(uid)) return NextResponse.json({ error: 'Unknown team' }, { status: 400 });
      if (!password || String(password).length < 4) {
        return NextResponse.json({ error: 'Password must be at least 4 characters' }, { status: 400 });
      }
      const existing = await col.findOne({ user_id: uid }, { projection: { passwordHash: 1 } });
      if (existing?.passwordHash) {
        return NextResponse.json({ error: 'Password already set — please log in', needsLogin: true }, { status: 409 });
      }
      await col.updateOne(
        { user_id: uid },
        {
          $set: {
            user_id: uid,
            passwordHash: hashPassword(password),
            phone: body?.phone ? String(body.phone).trim() : null,
            email: body?.email || null,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
      const res = NextResponse.json({ ok: true, user: { userId: uid, userName: USER_NAMES[uid] } });
      res.cookies.set(AUTH_COOKIE, signSession(uid), sessionCookieOptions());
      return res;
    }

    if (action === 'login') {
      if (!isValidTeam(uid)) return NextResponse.json({ error: 'Unknown team' }, { status: 400 });
      const rec = await col.findOne({ user_id: uid }, { projection: { passwordHash: 1 } });
      if (!rec?.passwordHash) {
        return NextResponse.json({ error: 'No password set yet', needsRegister: true }, { status: 404 });
      }
      if (!verifyPassword(password || '', rec.passwordHash)) {
        return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
      }
      await col.updateOne({ user_id: uid }, { $set: { lastLogin: new Date() } });
      const res = NextResponse.json({ ok: true, user: { userId: uid, userName: USER_NAMES[uid] } });
      res.cookies.set(AUTH_COOKIE, signSession(uid), sessionCookieOptions());
      return res;
    }

    if (action === 'admin-login') {
      if (!checkAdminPassword(body?.password)) {
        return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
      }
      const res = NextResponse.json({ ok: true, user: { userId: ADMIN_UID, userName: 'Admin', admin: true } });
      res.cookies.set(AUTH_COOKIE, signSession(ADMIN_UID), sessionCookieOptions());
      return res;
    }

    if (action === 'logout') {
      const res = NextResponse.json({ ok: true });
      res.cookies.set(AUTH_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
      return res;
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}

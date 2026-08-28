// src/app/api/duzza-finals/auth/route.js
// Duzza Finals — open-registration auth for "invited" entrants, standing
// alongside (not replacing) the main app's src/app/api/auth/route.js.
//   GET                        → whoami: finals cookie, else main-app session
//                                 (so the standalone app can recognise core
//                                 teams/admin too), else {entrantId: null}
//   POST { action:'register' } → claim a team name + pin, becomes an
//                                 invited entrant, signs in
//   POST { action:'login'    } → verify name + pin, signs in
//   POST { action:'logout'   } → clear the finals session cookie
// Data lives in duzza_finals.${year}_entrants alongside the core 8 (see
// seedEntrants in duzzaFinals.js) — registration just inserts more docs into
// the same collection with Source:'invited'.
import { NextResponse } from 'next/server';
import { connectToFinalsDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { getSessionUser, ADMIN_UID } from '@/app/lib/auth';
import {
  hashPin,
  verifyPin,
  createFinalsSessionCookie,
  clearFinalsSessionCookie,
  getFinalsSessionEntrant,
} from '@/app/lib/duzzaFinalsAuth';

const MAX_INVITED_ENTRANTS = 64;
// Invited ids start at 101 — see the entry route's INVITED_ID_THRESHOLD,
// which relies on this same boundary to tell invited ids apart from core
// (1-8) and admin (0) without a DB round-trip.
const INVITED_ID_BASE = 100;

function entrantsCollection(finalsDb, year) {
  return finalsDb.collection(`${year || CURRENT_YEAR}_entrants`);
}

function normalizeName(name) {
  return String(name || '').trim();
}

// Case-insensitive exact-name match, safe against regex metacharacters in a
// user-supplied name.
function exactNameRegex(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

// GET — whoami. A finals-session invited entrant takes priority; failing
// that, a valid main-app session (core team, uid 1-8, or admin uid 0) is
// recognised too, so the standalone app can show core users their identity
// without needing a second login.
export async function GET(request) {
  const finalsSess = getFinalsSessionEntrant(request);
  if (finalsSess) {
    const finalsDb = await connectToFinalsDatabase();
    const entrant = await entrantsCollection(finalsDb, CURRENT_YEAR).findOne({
      EntrantId: finalsSess.entrantId,
      Source: 'invited',
    });
    if (entrant) {
      return NextResponse.json({ entrantId: entrant.EntrantId, name: entrant.Name, source: 'invited' });
    }
    // Cookie refers to an entrant that no longer exists — fall through.
  }

  const mainSess = getSessionUser(request);
  if (mainSess) {
    if (mainSess.uid === ADMIN_UID) {
      return NextResponse.json({ entrantId: ADMIN_UID, name: 'Admin', source: 'admin' });
    }
    if (USER_NAMES[mainSess.uid]) {
      return NextResponse.json({ entrantId: mainSess.uid, name: USER_NAMES[mainSess.uid], source: 'core' });
    }
  }

  return NextResponse.json({ entrantId: null });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { action } = body || {};

  try {
    const finalsDb = await connectToFinalsDatabase();
    const col = entrantsCollection(finalsDb, CURRENT_YEAR);

    if (action === 'register') {
      const name = normalizeName(body?.name);
      const pin = body?.pin;

      if (name.length < 3 || name.length > 40) {
        return NextResponse.json({ error: 'Team name must be between 3 and 40 characters' }, { status: 400 });
      }
      if (!pin || String(pin).length < 4) {
        return NextResponse.json({ error: 'Pin must be at least 4 characters' }, { status: 400 });
      }

      // Unique case-insensitively across ALL entrants, core names included —
      // a registered team can't shadow (or be shadowed by) an existing one.
      const existing = await col.findOne({ Name: exactNameRegex(name) });
      if (existing) {
        return NextResponse.json({ error: 'That team name is already taken' }, { status: 409 });
      }

      const invitedCount = await col.countDocuments({ Source: 'invited' });
      if (invitedCount >= MAX_INVITED_ENTRANTS) {
        return NextResponse.json({ error: 'Registration is full' }, { status: 403 });
      }

      const invitedEntrants = await col
        .find({ Source: 'invited' }, { projection: { EntrantId: 1, _id: 0 } })
        .toArray();
      const maxId = invitedEntrants.reduce((max, e) => Math.max(max, Number(e.EntrantId) || 0), INVITED_ID_BASE);
      const entrantId = maxId + 1;

      await col.insertOne({
        EntrantId: entrantId,
        Name: name,
        Logo: null,
        Source: 'invited',
        PinHash: hashPin(pin),
        CreatedAt: new Date(),
      });

      const res = NextResponse.json({ entrantId, name });
      res.headers.append('Set-Cookie', createFinalsSessionCookie(entrantId));
      return res;
    }

    if (action === 'login') {
      const name = normalizeName(body?.name);
      const pin = body?.pin;

      const entrant = name ? await col.findOne({ Name: exactNameRegex(name), Source: 'invited' }) : null;

      // Same generic message whether the name is unknown or the pin is
      // wrong — don't leak which one it was.
      if (!entrant || !verifyPin(pin || '', entrant.PinHash)) {
        return NextResponse.json({ error: 'Incorrect team name or pin' }, { status: 401 });
      }

      const res = NextResponse.json({ entrantId: entrant.EntrantId, name: entrant.Name });
      res.headers.append('Set-Cookie', createFinalsSessionCookie(entrant.EntrantId));
      return res;
    }

    if (action === 'logout') {
      const res = NextResponse.json({ ok: true });
      res.headers.append('Set-Cookie', clearFinalsSessionCookie());
      return res;
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Duzza Finals auth error:', error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}

// src/app/lib/duzzaFinalsEntryDraft.js
//
// Pure rules for a Duzza Finals Entry draft (team + tips for one finals week),
// shared by both live finals UIs: the standalone /finals app
// (src/app/finals/enter/page.jsx) and the core-session page
// (src/app/hooks/useDuzzaFinals.js). Auth, fetching and React state stay in
// each UI; this module only turns saved data into a draft, edits it, and turns
// it back into the POST /api/duzza-finals/entry payload.
import { FINALS_ROUNDS } from '@/app/finals/lib/constants';

// Saved `[{MatchNumber, Match, Tip, DeadCert}]` → `{ [matchNumber]: { team, deadCert } }`.
export function tipsArrayToMap(tipsArray) {
  const map = {};
  (tipsArray || []).forEach((t) => {
    if (t && t.MatchNumber != null) {
      map[t.MatchNumber] = { team: t.Tip || '', deadCert: !!t.DeadCert };
    }
  });
  return map;
}

// The tips map a week's draft starts from: the saved tips, plus an entry for
// every fixture not yet tipped. The two UIs fill those gaps differently:
//   - homeTeamDefault: true (core page) — the home team, flagged isDefault,
//     same convention as the main tipping page. Editing starts from this map,
//     so an untouched game is SAVED as a home-team tip.
//   - homeTeamDefault: false (/finals app) — a blank tip, which is not saved.
export function draftTipsMap(savedTips, weekFixtures, { homeTeamDefault }) {
  const map = tipsArrayToMap(savedTips);
  (weekFixtures || []).forEach((f) => {
    if (!map[f.MatchNumber]) {
      map[f.MatchNumber] = homeTeamDefault
        ? { team: f.HomeTeam, deadCert: false, isDefault: true }
        : { team: '', deadCert: false };
    }
  });
  return map;
}

// Picking a different team for a game drops its dead cert.
export function selectTip(tipsMap, matchNumber, team) {
  const currentTeam = tipsMap[matchNumber]?.team;
  const isChangingTeam = currentTeam && currentTeam !== team;
  const deadCert = isChangingTeam ? false : tipsMap[matchNumber]?.deadCert;
  return { ...tipsMap, [matchNumber]: { team, deadCert, isDefault: false } };
}

export function toggleDeadCert(tipsMap, matchNumber) {
  return {
    ...tipsMap,
    [matchNumber]: { ...tipsMap[matchNumber], deadCert: !tipsMap[matchNumber]?.deadCert },
  };
}

export function setBenchBackup(team, backupPosition) {
  return { ...team, Bench: { ...(team.Bench || {}), backup_position: backupPosition } };
}

// Only fully-filled positions are sent — an empty/cleared slot is omitted
// rather than sent as `{}`, since the server flags any *present* key missing a
// player/club as an invalid position. A half-finished team is fine to save.
export function buildCleanedTeam(team) {
  const cleaned = {};
  Object.entries(team || {}).forEach(([position, slot]) => {
    if (slot && slot.player && slot.club) {
      cleaned[position] = position === 'Bench'
        ? { player: slot.player, club: slot.club, backup_position: slot.backup_position }
        : { player: slot.player, club: slot.club };
    }
  });
  return cleaned;
}

// Only games with a tip actually selected are sent.
export function buildTipsArray(weekFixtures, tipsMap) {
  return (weekFixtures || [])
    .filter((f) => tipsMap[f.MatchNumber]?.team)
    .map((f) => ({
      MatchNumber: f.MatchNumber,
      Match: `${f.HomeTeam} v ${f.AwayTeam}`,
      Tip: tipsMap[f.MatchNumber].team,
      DeadCert: !!tipsMap[f.MatchNumber].deadCert,
    }));
}

// The POST /api/duzza-finals/entry body. Pass `team` and/or `tipsMap` — the
// route $sets whichever fields are present, so a team-only, tips-only and
// combined save all go through here. `year` is omitted when not given (the
// /finals app lets the server default it).
export function buildEntryPayload({ round, userId, year, team, tipsMap, weekFixtures }) {
  const payload = { round, userId };
  if (team !== undefined) payload.team = buildCleanedTeam(team);
  if (tipsMap !== undefined) payload.tips = buildTipsArray(weekFixtures, tipsMap);
  if (year !== undefined) payload.year = year;
  return payload;
}

// The week to switch to when the results API reports its `currentWeek`, or
// null to leave the selection alone. A week the user picked themselves always
// wins. The UIs differ on a `currentWeek` outside the finals rounds:
//   - clampUnknown: true (core page) — fall back to the first finals week.
//   - clampUnknown: false (/finals app) — ignore it, keep the current week.
export function defaultWeekFromCurrent(currentWeek, { userChangedWeek, clampUnknown }) {
  if (userChangedWeek || !currentWeek) return null;
  if (FINALS_ROUNDS.includes(currentWeek)) return currentWeek;
  return clampUnknown ? FINALS_ROUNDS[0] : null;
}

// Whether the draft may be edited and saved. Each UI passes only what it has:
//   - core page: isPastYear, isAdmin (an admin may edit a locked week).
//   - /finals app: authLoading; no admin override and no past-year check.
// Being knocked out of the bracket does not stop entry — cut entrants keep
// playing for the pool.
export function canEditEntry({
  hasEntrant,
  fixturesKnown,
  locked,
  isAdmin = false,
  isPastYear = false,
  authLoading = false,
}) {
  return !authLoading
    && !isPastYear
    && !!fixturesKnown
    && !!hasEntrant
    && (isAdmin || !locked);
}

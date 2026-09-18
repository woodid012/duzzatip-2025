// src/app/lib/uniqueSelection.js
//
// One player, one position. The same name in two slots would score the one
// game twice, so a pick that lands on a player already in the team swaps the
// two slots instead of cloning them. These helpers are shared by the season
// team-selection hook, the Duzza Finals entry hook and the save API so all
// three agree on what counts as a duplicate.

// Team objects carry bookkeeping alongside the positions (the API tacks on
// _lastUpdated); anything not a position is not a pick.
const NON_POSITION_KEYS = new Set(['_lastUpdated']);

export function isPositionKey(key) {
  return !NON_POSITION_KEYS.has(key);
}

// Slot shapes differ by comp: season selections carry `player_name`, Duzza
// Finals entries carry `player`. Read whichever is there.
export function slotPlayerName(slot) {
  if (!slot) return '';
  return slot.player_name || slot.player || '';
}

// The position already holding `playerName`, ignoring `exceptPosition` (the
// slot being filled). Null when the player isn't in the team yet.
export function findPlayerPosition(team, playerName, exceptPosition = null) {
  if (!playerName) return null;
  const match = Object.entries(team || {}).find(
    ([position, slot]) =>
      isPositionKey(position) &&
      position !== exceptPosition &&
      slotPlayerName(slot) === playerName
  );
  return match ? match[0] : null;
}

// Which position each player currently fills: { playerName: position }. The
// pickers use it to flag a pick that will swap two slots.
export function positionsByPlayer(team) {
  const held = {};
  Object.entries(team || {}).forEach(([position, slot]) => {
    if (!isPositionKey(position)) return;
    const playerName = slotPlayerName(slot);
    if (playerName) held[playerName] = position;
  });
  return held;
}

// Every player sitting in more than one position: [{ playerName, positions }].
export function findDuplicateSelections(team) {
  const byPlayer = new Map();

  Object.entries(team || {}).forEach(([position, slot]) => {
    if (!isPositionKey(position)) return;
    const playerName = slotPlayerName(slot);
    if (!playerName) return;
    if (!byPlayer.has(playerName)) byPlayer.set(playerName, []);
    byPlayer.get(playerName).push(position);
  });

  return [...byPlayer.entries()]
    .filter(([, positions]) => positions.length > 1)
    .map(([playerName, positions]) => ({ playerName, positions }));
}

// Duplicates a save would leave behind, limited to the ones this save is
// responsible for. A duplicate already sitting in the stored team, in
// positions the payload doesn't touch, isn't this save's to reject.
export function duplicatesIntroduced(storedTeam, incomingPositions) {
  const incoming = incomingPositions || {};
  const merged = { ...(storedTeam || {}), ...incoming };
  const touched = new Set(Object.keys(incoming));

  return findDuplicateSelections(merged).filter(dupe =>
    dupe.positions.some(position => touched.has(position))
  );
}

// Applies a Duzza Finals pick to a team and hands back the new team. The
// finals slot shape is { player, club } plus a Bench-only backup_position,
// which belongs to the slot rather than to whoever fills it.
//
// A pick landing on a player already in the team swaps the two slots: this
// position takes them, and the slot they came from takes whoever this
// position was holding (empty when it was holding nobody). A null/empty
// `playerName` just clears the slot.
export function applyFinalsPick(team, position, playerName, club) {
  const prev = team || {};
  const next = { ...prev };
  const benchBackup = (slot) => ({ backup_position: slot?.backup_position || '' });

  if (!playerName) {
    next[position] = position === 'Bench' ? benchBackup(prev.Bench) : {};
    return next;
  }

  const heldAt = findPlayerPosition(prev, playerName, position);
  if (heldAt) {
    const displaced = prev[position] || {};
    const moved = displaced.player ? { player: displaced.player, club: displaced.club } : {};
    next[heldAt] = heldAt === 'Bench' ? { ...moved, ...benchBackup(prev.Bench) } : moved;
  }

  next[position] = { ...(prev[position] || {}), player: playerName, club };
  return next;
}

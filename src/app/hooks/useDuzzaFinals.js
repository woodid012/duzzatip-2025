'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { applyFinalsPick } from '@/app/lib/uniqueSelection';
import { readSnapshot, writeSnapshot } from '@/app/lib/clientSnapshot';
import { POSITION_TYPES } from '@/app/lib/constants';
import { getFinalsCurrentRound } from '@/app/lib/duzzaFinalsAutoPick';
import { FINALS_ROUNDS, FALLBACK_WEEK_LABELS, weekNumberForRound } from '@/app/finals/lib/constants';
import {
  draftTipsMap,
  selectTip,
  toggleDeadCert,
  setBenchBackup,
  buildEntryPayload,
  defaultWeekFromCurrent,
  canEditEntry,
} from '@/app/lib/duzzaFinalsEntryDraft';

// Bracket/pool poll cadence while a finals week is live — matches the
// per-round results view (src/app/finals/lib/useFinalsRoundResults.js).
const BRACKET_REFRESH_INTERVAL_MS = 60 * 1000;

const emptyEntry = () => ({ Team: {}, Tips: [], Name: '', LastUpdated: null });

export default function useDuzzaFinals(initialUserId = '', { isAdmin = false } = {}) {
  const { fixtures, selectedYear, isPastYear } = useAppContext();

  // ── Tabs & week selection ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('team'); // 'team' | 'tips' | 'bracket'
  // null until we know the week — starting at Week 1 made the Enter tab load
  // (and fetch) Week 1, then flip to the real week once the bracket answered.
  // Fixtures are already in AppContext, so seed from them straight away; the
  // bracket's currentWeek still wins when it arrives (same rule, server-side).
  const [activeWeek, setActiveWeek] = useState(null);
  const userChangedWeekRef = useRef(false);

  useEffect(() => {
    if (activeWeek != null || userChangedWeekRef.current) return;
    const week = getFinalsCurrentRound(fixtures || []);
    if (week != null) setActiveWeek(week);
  }, [fixtures, activeWeek]);

  // ── Entrant being viewed/edited ──────────────────────────────────────
  const [selectedEntrantId, setSelectedEntrantId] = useState(initialUserId);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (initialUserId && initialUserId !== 'admin' && initialUserId !== selectedEntrantId) {
      setSelectedEntrantId(initialUserId);
      setIsEditingTeam(false);
      setIsEditingTips(false);
      isInitializedRef.current = false;
    } else if (initialUserId === 'admin' && !selectedEntrantId) {
      setSelectedEntrantId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUserId]);

  // ── Bracket / results (drives default week, elimination state) ──────
  // Seed from the last bracket this tab saw, so coming back to the page paints
  // the week straight away and the refetch happens behind it. A stale snapshot
  // can't linger: fetchBracket runs on mount regardless.
  const bracketSnapshotKey = `duzza-finals-bracket:${selectedYear}`;
  const [bracket, setBracket] = useState(() => readSnapshot(bracketSnapshotKey) ?? null);
  const [bracketLoading, setBracketLoading] = useState(() => !readSnapshot(bracketSnapshotKey));
  // What's on screen, readable from inside fetchBracket without making the
  // bracket a dependency of it (which would re-trigger the fetch it feeds).
  const bracketRef = useRef(bracket);
  const [bracketRefreshing, setBracketRefreshing] = useState(false);
  const [bracketError, setBracketError] = useState(null);
  const [bracketUpdatedAt, setBracketUpdatedAt] = useState(null);

  // `background` = a poll tick: keep the scores on screen (no skeleton, and a
  // failed tick doesn't blow away the last good snapshot) so a live week's
  // numbers tick over in place.
  // `force` = the Refresh button: skip the server's shared snapshot and make it
  // recompute. An ordinary mount is happy with the snapshot.
  const fetchBracket = useCallback(async ({ background = false, force = false } = {}) => {
    try {
      // Only an empty screen gets the skeleton — a refetch over data already
      // showing is a background refresh, however it was triggered.
      if (background || bracketRef.current) setBracketRefreshing(true);
      else setBracketLoading(true);
      setBracketError(null);
      const res = await fetch(
        `/api/duzza-finals/results?year=${selectedYear}${force ? '&refresh=1' : ''}`,
        // A poll is a freshness check, so it always goes to the network; the
        // read-cache header is there for navigations.
        { cache: 'no-store' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load bracket (${res.status})`);
      }
      const data = await res.json();
      setBracket(data);
      bracketRef.current = data;
      writeSnapshot(`duzza-finals-bracket:${selectedYear}`, data);
      setBracketUpdatedAt(new Date());
      const week = defaultWeekFromCurrent(data?.currentWeek, {
        userChangedWeek: userChangedWeekRef.current,
        clampUnknown: true,
      });
      if (week != null) setActiveWeek(week);
    } catch (err) {
      console.error('Error loading Duzza Finals bracket:', err);
      if (!background) {
        setBracketError(err.message);
        setActiveWeek((w) => w ?? FINALS_ROUNDS[0]);
      }
    } finally {
      setBracketRefreshing(false);
      setBracketLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => { fetchBracket(); }, [fetchBracket]);

  // Keep the live week's scores moving: poll while the tab is visible and the
  // finals haven't been decided. Refetch immediately on becoming visible too,
  // so coming back to a backgrounded phone doesn't show minutes-old scores.
  const finalsComplete = !!bracket?.isComplete;
  useEffect(() => {
    if (finalsComplete) return undefined;

    const tick = () => {
      if (document.visibilityState === 'visible') fetchBracket({ background: true });
    };
    const interval = setInterval(tick, BRACKET_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [fetchBracket, finalsComplete]);

  const refreshBracket = useCallback(() => fetchBracket({ force: true }), [fetchBracket]);

  // ── Player pool for the active week ──────────────────────────────────
  const [pool, setPool] = useState({ fixturesKnown: false, teamsPlaying: [], playersByTeam: {} });
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState(null);

  const fetchPool = useCallback(async (round, year) => {
    try {
      setPoolLoading(true);
      setPoolError(null);
      const res = await fetch(`/api/duzza-finals/players?round=${round}&year=${year}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load players (${res.status})`);
      }
      const data = await res.json();
      setPool({
        fixturesKnown: !!data.fixturesKnown,
        teamsPlaying: data.teamsPlaying || [],
        playersByTeam: data.playersByTeam || {},
      });
    } catch (err) {
      console.error('Error loading Duzza Finals player pool:', err);
      setPoolError(err.message);
      setPool({ fixturesKnown: false, teamsPlaying: [], playersByTeam: {} });
    } finally {
      setPoolLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeWeek == null) return;
    fetchPool(activeWeek, selectedYear);
  }, [activeWeek, selectedYear, fetchPool]);

  // ── Entries (team + tips) for the active week ────────────────────────
  const [entryLocked, setEntryLocked] = useState(true);
  const [entries, setEntries] = useState({}); // { [entrantId]: { Team, Tips, Name, LastUpdated } }
  const [entryLoading, setEntryLoading] = useState(true);
  const [entryError, setEntryError] = useState(null);

  const fetchEntry = useCallback(async (round, year) => {
    try {
      setEntryLoading(true);
      setEntryError(null);
      const res = await fetch(`/api/duzza-finals/entry?round=${round}&year=${year}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load entries (${res.status})`);
      }
      const data = await res.json();
      setEntryLocked(!!data.locked);
      setEntries(data.entries || {});
    } catch (err) {
      console.error('Error loading Duzza Finals entries:', err);
      setEntryError(err.message);
    } finally {
      setEntryLoading(false);
      isInitializedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (activeWeek == null) return;
    fetchEntry(activeWeek, selectedYear);
    setIsEditingTeam(false);
    setIsEditingTips(false);
  }, [activeWeek, selectedYear, fetchEntry]);

  const savedEntry = entries[selectedEntrantId] || emptyEntry();

  // Being knocked out of the bracket doesn't stop you entering — cut entrants
  // keep playing for the pool, so eligibility is just locked/fixtures/entrant.
  const canEdit = canEditEntry({
    hasEntrant: !!selectedEntrantId,
    fixturesKnown: pool.fixturesKnown,
    locked: entryLocked,
    isAdmin,
    isPastYear,
  });

  // ── Team editing ──────────────────────────────────────────────────────
  const [editedTeam, setEditedTeam] = useState({});
  const [isEditingTeam, setIsEditingTeam] = useState(false);
  const [teamDirty, setTeamDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [actionError, setActionError] = useState(null);

  const startEditingTeam = useCallback(() => {
    if (!canEdit) return;
    setEditedTeam({ ...savedEntry.Team });
    setTeamDirty(false);
    setIsEditingTeam(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, selectedEntrantId, activeWeek, entries]);

  const cancelEditingTeam = useCallback(() => {
    setEditedTeam({ ...savedEntry.Team });
    setTeamDirty(false);
    setIsEditingTeam(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntrantId, activeWeek, entries]);

  const handlePlayerChange = useCallback((position, playerName, club) => {
    if (!isEditingTeam) return;
    // One player, one position — the same name in two slots would score the one
    // game twice, so a player already in the team swaps slots rather than
    // being cloned into a second one.
    setEditedTeam((prev) => applyFinalsPick(prev, position, playerName, club));
    setTeamDirty(true);
  }, [isEditingTeam]);

  const handleBackupPositionChange = useCallback((newPosition) => {
    if (!isEditingTeam) return;
    setEditedTeam((prev) => setBenchBackup(prev, newPosition));
    setTeamDirty(true);
  }, [isEditingTeam]);

  const saveTeam = useCallback(async () => {
    if (!canEdit || !selectedEntrantId) return false;
    try {
      setSaving(true);
      setActionError(null);
      const payload = buildEntryPayload({
        round: activeWeek, userId: selectedEntrantId, year: selectedYear, team: editedTeam,
      });
      const res = await fetch('/api/duzza-finals/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save team');
      setEntries((prev) => ({
        ...prev,
        [selectedEntrantId]: {
          ...(prev[selectedEntrantId] || emptyEntry()),
          Team: payload.team,
          LastUpdated: new Date().toISOString(),
        },
      }));
      setIsEditingTeam(false);
      setTeamDirty(false);
      setSuccessMessage('Team saved!');
      setTimeout(() => setSuccessMessage(''), 3000);
      return true;
    } catch (err) {
      console.error('Error saving Duzza Finals team:', err);
      setActionError(err.message);
      setTimeout(() => setActionError(null), 4000);
      return false;
    } finally {
      setSaving(false);
    }
  }, [canEdit, selectedEntrantId, activeWeek, selectedYear, editedTeam]);

  // ── Tips editing ──────────────────────────────────────────────────────
  const weekFixtures = (fixtures || [])
    .filter((f) => f.RoundNumber === activeWeek || f.RoundNumber?.toString() === activeWeek?.toString())
    .sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc) || a.MatchNumber - b.MatchNumber);

  // Default un-tipped games to the home team for display, same convention as
  // the main tipping page — purely a display default, not saved until edited.
  const displayTipsMap = draftTipsMap(savedEntry.Tips, weekFixtures, { homeTeamDefault: true });

  const [editedTips, setEditedTips] = useState({});
  const [isEditingTips, setIsEditingTips] = useState(false);
  const [tipsDirty, setTipsDirty] = useState(false);

  const startEditingTips = useCallback(() => {
    if (!canEdit) return;
    setEditedTips({ ...displayTipsMap });
    setTipsDirty(false);
    setIsEditingTips(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, selectedEntrantId, activeWeek, entries, fixtures]);

  const cancelEditingTips = useCallback(() => {
    setEditedTips({ ...displayTipsMap });
    setTipsDirty(false);
    setIsEditingTips(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntrantId, activeWeek, entries, fixtures]);

  const handleTipSelect = useCallback((matchNumber, team) => {
    if (!isEditingTips) return;
    setEditedTips((prev) => selectTip(prev, matchNumber, team));
    setTipsDirty(true);
  }, [isEditingTips]);

  const handleDeadCertToggle = useCallback((matchNumber) => {
    if (!isEditingTips) return;
    setEditedTips((prev) => toggleDeadCert(prev, matchNumber));
    setTipsDirty(true);
  }, [isEditingTips]);

  const saveTips = useCallback(async () => {
    if (!canEdit || !selectedEntrantId) return false;
    try {
      setSaving(true);
      setActionError(null);
      const payload = buildEntryPayload({
        round: activeWeek, userId: selectedEntrantId, year: selectedYear,
        tipsMap: editedTips, weekFixtures,
      });
      const res = await fetch('/api/duzza-finals/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save tips');
      setEntries((prev) => ({
        ...prev,
        [selectedEntrantId]: {
          ...(prev[selectedEntrantId] || emptyEntry()),
          Tips: payload.tips,
          LastUpdated: new Date().toISOString(),
        },
      }));
      setIsEditingTips(false);
      setTipsDirty(false);
      setSuccessMessage('Tips saved!');
      setTimeout(() => setSuccessMessage(''), 3000);
      return true;
    } catch (err) {
      console.error('Error saving Duzza Finals tips:', err);
      setActionError(err.message);
      setTimeout(() => setActionError(null), 4000);
      return false;
    } finally {
      setSaving(false);
    }
  }, [canEdit, selectedEntrantId, activeWeek, selectedYear, editedTips, weekFixtures]);

  // ── Combined entry editing (mobile "Enter" tab — team + tips, one save) ─
  const startEditingEntry = useCallback(() => {
    if (!canEdit) return;
    setEditedTeam({ ...savedEntry.Team });
    setTeamDirty(false);
    setIsEditingTeam(true);
    setEditedTips({ ...displayTipsMap });
    setTipsDirty(false);
    setIsEditingTips(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, selectedEntrantId, activeWeek, entries, fixtures]);

  const cancelEditingEntry = useCallback(() => {
    setEditedTeam({ ...savedEntry.Team });
    setTeamDirty(false);
    setIsEditingTeam(false);
    setEditedTips({ ...displayTipsMap });
    setTipsDirty(false);
    setIsEditingTips(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntrantId, activeWeek, entries, fixtures]);

  // First look at a week with nothing entered yet → drop straight into
  // editing mode, so the pickers are immediately usable instead of an empty
  // read-only view behind an Edit button. Keyed per entrant/week so a
  // deliberate Cancel isn't fought on the next render.
  const autoEditKeyRef = useRef(null);
  useEffect(() => {
    if (!canEdit || entryLoading || poolLoading) return;
    const key = `${selectedEntrantId}|${activeWeek}|${selectedYear}`;
    if (autoEditKeyRef.current === key) return;
    const savedTeam = savedEntry.Team;
    const teamEmpty = !savedTeam || !Object.values(savedTeam).some((s) => s?.player);
    if (teamEmpty && !isEditingTeam && !isEditingTips) {
      autoEditKeyRef.current = key;
      startEditingEntry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, entryLoading, poolLoading, selectedEntrantId, activeWeek, selectedYear, entries]);

  // One POST carrying both `team` and `tips` — the route $sets whichever
  // fields are present, so a single combined save is exactly as safe as the
  // two separate saves it replaces.
  const saveEntry = useCallback(async () => {
    if (!canEdit || !selectedEntrantId) return false;
    try {
      setSaving(true);
      setActionError(null);
      const payload = buildEntryPayload({
        round: activeWeek, userId: selectedEntrantId, year: selectedYear,
        team: editedTeam, tipsMap: editedTips, weekFixtures,
      });
      const res = await fetch('/api/duzza-finals/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setEntries((prev) => ({
        ...prev,
        [selectedEntrantId]: {
          ...(prev[selectedEntrantId] || emptyEntry()),
          Team: payload.team,
          Tips: payload.tips,
          LastUpdated: new Date().toISOString(),
        },
      }));
      setIsEditingTeam(false);
      setTeamDirty(false);
      setIsEditingTips(false);
      setTipsDirty(false);
      setSuccessMessage('Saved!');
      setTimeout(() => setSuccessMessage(''), 3000);
      return true;
    } catch (err) {
      console.error('Error saving Duzza Finals entry:', err);
      setActionError(err.message);
      setTimeout(() => setActionError(null), 4000);
      return false;
    } finally {
      setSaving(false);
    }
  }, [canEdit, selectedEntrantId, activeWeek, selectedYear, editedTeam, editedTips, weekFixtures]);

  // ── Week selector & labels ────────────────────────────────────────────
  const weekOptions = FINALS_ROUNDS.map((round) => {
    const bracketWeek = (bracket?.weeks || []).find((w) => w.round === round);
    const label = bracketWeek?.label || FALLBACK_WEEK_LABELS[round];
    return {
      round,
      weekNumber: weekNumberForRound(round),
      label,
      display: `Week ${weekNumberForRound(round)} · ${label}`,
    };
  });

  const handleWeekChange = useCallback((round) => {
    userChangedWeekRef.current = true;
    setActiveWeek(round);
  }, []);

  const changeEntrant = useCallback((entrantId) => {
    if (entrantId === selectedEntrantId) return;
    setSelectedEntrantId(entrantId);
    setIsEditingTeam(false);
    setIsEditingTips(false);
    setTeamDirty(false);
    setTipsDirty(false);
  }, [selectedEntrantId]);

  // ── Elimination helpers ───────────────────────────────────────────────
  const isEliminated = useCallback((userId) => {
    if (!bracket?.weeks) return false;
    return bracket.weeks.some((w) => Array.isArray(w.eliminated) && w.eliminated.map(String).includes(String(userId)));
  }, [bracket]);

  const viewerEliminated = !isAdmin && initialUserId ? isEliminated(initialUserId) : false;

  return {
    // Tabs
    activeTab,
    setActiveTab,

    // Week
    activeWeek,
    weekOptions,
    handleWeekChange,

    // Entrant
    selectedEntrantId,
    changeEntrant,

    // Player pool
    fixturesKnown: pool.fixturesKnown,
    teamsPlaying: pool.teamsPlaying,
    playersByTeam: pool.playersByTeam,
    poolLoading,
    poolError,

    // Team tab
    team: isEditingTeam ? editedTeam : savedEntry.Team,
    isEditingTeam,
    teamDirty,
    startEditingTeam,
    cancelEditingTeam,
    handlePlayerChange,
    handleBackupPositionChange,
    saveTeam,

    // Tips tab
    weekFixtures,
    tips: isEditingTips ? editedTips : displayTipsMap,
    isEditingTips,
    tipsDirty,
    startEditingTips,
    cancelEditingTips,
    handleTipSelect,
    handleDeadCertToggle,
    saveTips,

    // Combined entry editing (mobile "Enter" tab — team + tips, one save)
    isEditingEntry: isEditingTeam || isEditingTips,
    entryDirty: teamDirty || tipsDirty,
    startEditingEntry,
    cancelEditingEntry,
    saveEntry,

    // Locking / eligibility
    entryLocked,
    canEdit,
    isPastYear,

    // Bracket / results
    bracket,
    bracketLoading,
    bracketRefreshing,
    bracketUpdatedAt,
    bracketError,
    refreshBracket,
    isEliminated,
    viewerEliminated,

    // Status
    loading: bracketLoading || poolLoading || entryLoading,
    entryLoading,
    error: bracketError || poolError || entryError,
    actionError,
    saving,
    successMessage,
    lastUpdated: savedEntry.LastUpdated,
    entryName: savedEntry.Name,
  };
}

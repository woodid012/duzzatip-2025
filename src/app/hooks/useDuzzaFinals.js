'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '@/app/context/AppContext';
import { POSITION_TYPES } from '@/app/lib/constants';

// Duzza Finals runs over AFL rounds 26–29 (Qualifying & Elimination Finals,
// Semi Finals, Preliminary Finals, Grand Final) — kept local to this hook
// (not imported from the backend-owned src/app/lib/duzzaFinals.js) so the
// frontend has no build-order dependency on that file existing yet. These
// are display fallbacks only; once the results API responds, its per-week
// `label` is preferred.
export const DUZZA_FINALS_ROUNDS = [26, 27, 28, 29];
const FALLBACK_ROUND_LABELS = {
  26: 'Qualifying & Elimination Finals',
  27: 'Semi Finals',
  28: 'Preliminary Finals',
  29: 'Grand Final',
};
const weekNumberForRound = (round) => round - 25;

const emptyEntry = () => ({ Team: {}, Tips: [], Name: '', LastUpdated: null });

// Parse a saved `[{MatchNumber, Match, Tip, DeadCert}]` Tips array into the
// `{ [matchNumber]: { team, deadCert } }` map the tips tab edits against.
const tipsArrayToMap = (tipsArray) => {
  const map = {};
  (tipsArray || []).forEach((t) => {
    if (t && t.MatchNumber != null) {
      map[t.MatchNumber] = { team: t.Tip || '', deadCert: !!t.DeadCert };
    }
  });
  return map;
};

// Only fully-filled positions are sent — an empty/cleared slot (no player
// picked, or picked then cleared) is omitted rather than sent as `{}`, since
// the server flags any *present* key missing a player/club as an invalid
// position. A half-finished team is fine to save; a malformed one isn't.
const buildCleanedTeam = (team) => {
  const cleaned = {};
  Object.entries(team || {}).forEach(([position, slot]) => {
    if (slot && slot.player && slot.club) {
      cleaned[position] = position === 'Bench'
        ? { player: slot.player, club: slot.club, backup_position: slot.backup_position }
        : { player: slot.player, club: slot.club };
    }
  });
  return cleaned;
};

// Only games with a tip actually selected are sent.
const buildTipsArray = (weekFixtures, tipsMap) =>
  (weekFixtures || [])
    .filter((f) => tipsMap[f.MatchNumber]?.team)
    .map((f) => ({
      MatchNumber: f.MatchNumber,
      Match: `${f.HomeTeam} v ${f.AwayTeam}`,
      Tip: tipsMap[f.MatchNumber].team,
      DeadCert: !!tipsMap[f.MatchNumber].deadCert,
    }));

export default function useDuzzaFinals(initialUserId = '', { isAdmin = false } = {}) {
  const { fixtures, selectedYear, isPastYear } = useAppContext();

  // ── Tabs & week selection ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('team'); // 'team' | 'tips' | 'bracket'
  const [activeWeek, setActiveWeek] = useState(DUZZA_FINALS_ROUNDS[0]);
  const userChangedWeekRef = useRef(false);

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
  const [bracket, setBracket] = useState(null);
  const [bracketLoading, setBracketLoading] = useState(true);
  const [bracketError, setBracketError] = useState(null);

  const fetchBracket = useCallback(async () => {
    try {
      setBracketLoading(true);
      setBracketError(null);
      const res = await fetch(`/api/duzza-finals/results?year=${selectedYear}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load bracket (${res.status})`);
      }
      const data = await res.json();
      setBracket(data);
      if (!userChangedWeekRef.current && data?.currentWeek) {
        const clamped = DUZZA_FINALS_ROUNDS.includes(data.currentWeek)
          ? data.currentWeek
          : DUZZA_FINALS_ROUNDS[0];
        setActiveWeek(clamped);
      }
    } catch (err) {
      console.error('Error loading Duzza Finals bracket:', err);
      setBracketError(err.message);
    } finally {
      setBracketLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => { fetchBracket(); }, [fetchBracket]);

  const refreshBracket = useCallback(() => fetchBracket(), [fetchBracket]);

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

  // ── Eligibility for the active week (locked / fixtures / eliminated) ─
  const weekBracket = (bracket?.weeks || []).find((w) => w.round === activeWeek) || null;
  const isEligibleThisWeek = (() => {
    if (!selectedEntrantId) return false;
    if (!weekBracket || !Array.isArray(weekBracket.aliveAtStart)) return true; // unknown → assume ok, server enforces
    return weekBracket.aliveAtStart.map(String).includes(String(selectedEntrantId));
  })();

  const canEdit = !isPastYear
    && pool.fixturesKnown
    && !!selectedEntrantId
    && (isAdmin || !entryLocked)
    && (isAdmin || isEligibleThisWeek);

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
    setEditedTeam((prev) => {
      const next = { ...prev };
      if (!playerName) {
        next[position] = position === 'Bench' ? { backup_position: prev[position]?.backup_position || '' } : {};
      } else {
        next[position] = { ...(prev[position] || {}), player: playerName, club };
      }
      return next;
    });
    setTeamDirty(true);
  }, [isEditingTeam]);

  const handleBackupPositionChange = useCallback((newPosition) => {
    if (!isEditingTeam) return;
    setEditedTeam((prev) => ({
      ...prev,
      Bench: { ...(prev.Bench || {}), backup_position: newPosition },
    }));
    setTeamDirty(true);
  }, [isEditingTeam]);

  const saveTeam = useCallback(async () => {
    if (!canEdit || !selectedEntrantId) return false;
    try {
      setSaving(true);
      setActionError(null);
      const cleanedTeam = buildCleanedTeam(editedTeam);
      const res = await fetch('/api/duzza-finals/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round: activeWeek,
          userId: selectedEntrantId,
          team: cleanedTeam,
          year: selectedYear,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save team');
      setEntries((prev) => ({
        ...prev,
        [selectedEntrantId]: {
          ...(prev[selectedEntrantId] || emptyEntry()),
          Team: cleanedTeam,
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
  const savedTipsMap = tipsArrayToMap(savedEntry.Tips);
  const displayTipsMap = { ...savedTipsMap };
  weekFixtures.forEach((f) => {
    if (!displayTipsMap[f.MatchNumber]) {
      displayTipsMap[f.MatchNumber] = { team: f.HomeTeam, deadCert: false, isDefault: true };
    }
  });

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
    setEditedTips((prev) => {
      const currentTeam = prev[matchNumber]?.team;
      const isChangingTeam = currentTeam && currentTeam !== team;
      const deadCert = isChangingTeam ? false : prev[matchNumber]?.deadCert;
      return { ...prev, [matchNumber]: { team, deadCert, isDefault: false } };
    });
    setTipsDirty(true);
  }, [isEditingTips]);

  const handleDeadCertToggle = useCallback((matchNumber) => {
    if (!isEditingTips) return;
    setEditedTips((prev) => ({
      ...prev,
      [matchNumber]: { ...prev[matchNumber], deadCert: !prev[matchNumber]?.deadCert },
    }));
    setTipsDirty(true);
  }, [isEditingTips]);

  const saveTips = useCallback(async () => {
    if (!canEdit || !selectedEntrantId) return false;
    try {
      setSaving(true);
      setActionError(null);
      const tipsArray = weekFixtures
        .filter((f) => editedTips[f.MatchNumber]?.team)
        .map((f) => ({
          MatchNumber: f.MatchNumber,
          Match: `${f.HomeTeam} v ${f.AwayTeam}`,
          Tip: editedTips[f.MatchNumber].team,
          DeadCert: !!editedTips[f.MatchNumber].deadCert,
        }));
      const res = await fetch('/api/duzza-finals/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round: activeWeek,
          userId: selectedEntrantId,
          tips: tipsArray,
          year: selectedYear,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save tips');
      setEntries((prev) => ({
        ...prev,
        [selectedEntrantId]: {
          ...(prev[selectedEntrantId] || emptyEntry()),
          Tips: tipsArray,
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

  // ── Week selector & labels ────────────────────────────────────────────
  const weekOptions = DUZZA_FINALS_ROUNDS.map((round) => {
    const bracketWeek = (bracket?.weeks || []).find((w) => w.round === round);
    const label = bracketWeek?.label || FALLBACK_ROUND_LABELS[round];
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

    // Locking / eligibility
    entryLocked,
    isEligibleThisWeek,
    canEdit,
    isPastYear,

    // Bracket / results
    bracket,
    bracketLoading,
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

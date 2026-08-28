'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useFinalsAuth } from '../context';
import useFinalsResults from '../lib/useFinalsResults';
import { fetchJSON, postJSON } from '../lib/api';
import { FINALS_ROUNDS, FALLBACK_WEEK_LABELS, weekNumberForRound } from '../lib/constants';
import { LoadingSkeleton, ErrorCard, EmptyCard } from '../components/StatusCard';
import TeamSlots from '../components/TeamSlots';
import TipsList from '../components/TipsList';

const emptyTeam = () => ({});
const emptyTipsMap = () => ({});

function tipsArrayToMap(tipsArray) {
  const map = {};
  (tipsArray || []).forEach((t) => {
    if (t && t.MatchNumber != null) {
      map[t.MatchNumber] = { team: t.Tip || '', deadCert: !!t.DeadCert };
    }
  });
  return map;
}

// Only fully-filled positions are sent — the server rejects a *present* key
// missing a player/club, but a half-finished team (some slots empty) is fine.
function buildCleanedTeam(team) {
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

function buildTipsArray(weekFixtures, tipsMap) {
  return (weekFixtures || [])
    .filter((f) => tipsMap[f.MatchNumber]?.team)
    .map((f) => ({
      MatchNumber: f.MatchNumber,
      Match: `${f.HomeTeam} v ${f.AwayTeam}`,
      Tip: tipsMap[f.MatchNumber].team,
      DeadCert: !!tipsMap[f.MatchNumber].deadCert,
    }));
}

export default function EnterPage() {
  const { entrantId, name, loading: authLoading } = useFinalsAuth();
  const { data: results } = useFinalsResults();

  // ── Week selection — defaults to currentWeek once results load ────────
  const [activeWeek, setActiveWeek] = useState(FINALS_ROUNDS[0]);
  const userChangedWeekRef = useRef(false);
  useEffect(() => {
    if (!userChangedWeekRef.current && results?.currentWeek && FINALS_ROUNDS.includes(results.currentWeek)) {
      setActiveWeek(results.currentWeek);
    }
  }, [results?.currentWeek]);

  const weekOptions = FINALS_ROUNDS.map((round) => {
    const apiWeek = (results?.weeks || []).find((w) => w.round === round);
    const label = apiWeek?.label || FALLBACK_WEEK_LABELS[round];
    return { round, display: `Week ${weekNumberForRound(round)} · ${label}` };
  });

  // ── All AFL fixtures (fetched once, filtered per-week client side) ────
  const [allFixtures, setAllFixtures] = useState([]);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchJSON('/api/tipping-data')
      .then((data) => { if (!cancelled) setAllFixtures(Array.isArray(data) ? data : data.fixtures || []); })
      .catch(() => { if (!cancelled) setAllFixtures([]); })
      .finally(() => { if (!cancelled) setFixturesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const weekFixtures = useMemo(() => allFixtures
    .filter((f) => Number(f.RoundNumber) === Number(activeWeek))
    .sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc) || a.MatchNumber - b.MatchNumber),
  [allFixtures, activeWeek]);

  // ── Player pool for the active week ────────────────────────────────────
  const [pool, setPool] = useState({ fixturesKnown: false, teamsPlaying: [], playersByTeam: {} });
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState(null);

  const fetchPool = useCallback(async (round) => {
    try {
      setPoolLoading(true);
      setPoolError(null);
      const data = await fetchJSON(`/api/duzza-finals/players?round=${round}`);
      setPool({ fixturesKnown: !!data.fixturesKnown, teamsPlaying: data.teamsPlaying || [], playersByTeam: data.playersByTeam || {} });
    } catch (err) {
      setPoolError(err.message);
      setPool({ fixturesKnown: false, teamsPlaying: [], playersByTeam: {} });
    } finally {
      setPoolLoading(false);
    }
  }, []);
  useEffect(() => { fetchPool(activeWeek); }, [activeWeek, fetchPool]);

  // ── Entry (team + tips) for the active week ────────────────────────────
  const [locked, setLocked] = useState(true);
  const [savedEntry, setSavedEntry] = useState(null); // { Team, Tips } | null
  const [entryLoading, setEntryLoading] = useState(true);
  const [entryError, setEntryError] = useState(null);

  const fetchEntry = useCallback(async (round) => {
    try {
      setEntryLoading(true);
      setEntryError(null);
      const data = await fetchJSON(`/api/duzza-finals/entry?round=${round}`);
      setLocked(!!data.locked);
      const mine = entrantId != null ? data.entries?.[entrantId] : null;
      setSavedEntry(mine || { Team: {}, Tips: [] });
    } catch (err) {
      setEntryError(err.message);
    } finally {
      setEntryLoading(false);
    }
  }, [entrantId]);
  useEffect(() => { if (entrantId != null) fetchEntry(activeWeek); }, [activeWeek, entrantId, fetchEntry]);

  // ── Local edit state, reset whenever the saved entry (re)loads ────────
  const [team, setTeam] = useState(emptyTeam());
  const [tipsMap, setTipsMap] = useState(emptyTipsMap());
  useEffect(() => {
    if (!savedEntry) return;
    setTeam({ ...(savedEntry.Team || {}) });
    const map = tipsArrayToMap(savedEntry.Tips);
    weekFixtures.forEach((f) => {
      if (!map[f.MatchNumber]) map[f.MatchNumber] = { team: '', deadCert: false };
    });
    setTipsMap(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedEntry]);

  const canEdit = !authLoading && entrantId != null && pool.fixturesKnown && !locked;

  const handlePlayerChange = (position, playerName, club) => {
    if (!canEdit) return;
    setTeam((prev) => {
      const next = { ...prev };
      if (!playerName) {
        next[position] = position === 'Bench' ? { backup_position: prev[position]?.backup_position || '' } : {};
      } else {
        next[position] = { ...(prev[position] || {}), player: playerName, club };
      }
      return next;
    });
  };

  const handleBackupChange = (backupPosition) => {
    if (!canEdit) return;
    setTeam((prev) => ({ ...prev, Bench: { ...(prev.Bench || {}), backup_position: backupPosition } }));
  };

  const handleTipSelect = (matchNumber, teamPicked) => {
    if (!canEdit) return;
    setTipsMap((prev) => {
      const currentTeam = prev[matchNumber]?.team;
      const changingTeam = currentTeam && currentTeam !== teamPicked;
      const deadCert = changingTeam ? false : prev[matchNumber]?.deadCert;
      return { ...prev, [matchNumber]: { team: teamPicked, deadCert } };
    });
  };

  const handleDeadCertToggle = (matchNumber) => {
    if (!canEdit) return;
    setTipsMap((prev) => ({ ...prev, [matchNumber]: { ...prev[matchNumber], deadCert: !prev[matchNumber]?.deadCert } }));
  };

  // ── Save ─────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const cleanedTeam = buildCleanedTeam(team);
      const tipsArray = buildTipsArray(weekFixtures, tipsMap);
      await postJSON('/api/duzza-finals/entry', {
        round: activeWeek,
        userId: entrantId,
        team: cleanedTeam,
        tips: tipsArray,
      });
      setSavedEntry({ Team: cleanedTeam, Tips: tipsArray });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deadCertCount = weekFixtures.filter((f) => tipsMap[f.MatchNumber]?.deadCert).length;

  // ═══════════════════ render ═══════════════════
  if (authLoading) return <LoadingSkeleton />;

  if (entrantId == null) {
    return (
      <EmptyCard title="Sign in to enter">
        Register a team or log in from the{' '}
        <Link href="/finals" className="text-blue-600 font-semibold hover:underline">Rules page</Link>{' '}
        to enter your team.
      </EmptyCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="dz-page-header mb-0">
        <div>
          <div className="dz-subtitle">Signed in as <span className="font-semibold text-slate-700">{name}</span></div>
          <h1 className="dz-title">Enter your team</h1>
        </div>
        <select
          value={activeWeek}
          onChange={(e) => { userChangedWeekRef.current = true; setActiveWeek(Number(e.target.value)); }}
          className="dz-select"
        >
          {weekOptions.map((w) => <option key={w.round} value={w.round}>{w.display}</option>)}
        </select>
      </div>

      {saveSuccess && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 text-sm font-medium">
          Saved!
        </div>
      )}
      {saveError && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-3 text-sm font-medium">
          {saveError}
        </div>
      )}

      {(poolLoading || entryLoading || fixturesLoading) ? (
        <LoadingSkeleton rows={6} />
      ) : poolError || entryError ? (
        <ErrorCard message={poolError || entryError} onRetry={() => { fetchPool(activeWeek); fetchEntry(activeWeek); }} />
      ) : !pool.fixturesKnown ? (
        <EmptyCard title="Fixtures not locked in yet">
          Fixtures for this week aren&apos;t confirmed yet — check back closer to game day.
        </EmptyCard>
      ) : (
        <>
          {locked && (
            <div className="rounded-xl bg-slate-100 border border-slate-200 text-slate-600 p-3 text-sm font-medium">
              🔒 This week is locked — the first game has bounced. Your team and tips are final for this week.
            </div>
          )}

          {pool.teamsPlaying?.length > 0 && (
            <div className="text-xs text-slate-500 px-1">
              Clubs playing this week: <span className="font-medium text-slate-700">{pool.teamsPlaying.join(', ')}</span>
            </div>
          )}

          <div className="dz-surface p-3 sm:p-4">
            <h2 className="text-sm font-bold text-slate-900 mb-3 px-1">Your team</h2>
            <TeamSlots
              playersByTeam={pool.playersByTeam}
              team={team}
              onPlayerChange={handlePlayerChange}
              onBackupChange={handleBackupChange}
              disabled={!canEdit}
            />
          </div>

          <div>
            <div className="flex items-center justify-between px-1 mb-3">
              <h2 className="text-sm font-bold text-slate-900">Tips</h2>
              {deadCertCount > 0 && (
                <span className="text-xs font-semibold text-amber-600">⭐ {deadCertCount} dead cert{deadCertCount > 1 ? 's' : ''}</span>
              )}
            </div>
            <TipsList
              fixtures={weekFixtures}
              tips={tipsMap}
              onTipSelect={handleTipSelect}
              onDeadCertToggle={handleDeadCertToggle}
              disabled={!canEdit}
            />
          </div>

          {!locked && (
            <div className="sticky bottom-4 flex justify-center pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="dz-btn-primary bg-emerald-500 hover:bg-emerald-600 shadow-lg px-8"
              >
                {saving ? 'Saving…' : 'Save team & tips'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

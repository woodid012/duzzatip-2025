'use client';

import { useUserContext } from '../layout';
import useDuzzaFinals from '@/app/hooks/useDuzzaFinals';
import { USER_NAMES } from '@/app/lib/constants';
import { useToast } from '@/app/components/Toast';
import ScoreboardHeader from '@/app/components/ScoreboardHeader';
import MyTeamTab from './components/MyTeamTab';
import TipsTab from './components/TipsTab';
import BracketTab from './components/BracketTab';

const TABS = [
  { id: 'team', label: 'My Team' },
  { id: 'tips', label: 'Tips' },
  { id: 'bracket', label: 'Bracket' },
];

export default function DuzzaFinalsPage() {
  const { selectedUserId } = useUserContext();
  const isAdmin = selectedUserId === 'admin';

  const {
    activeTab, setActiveTab,
    activeWeek, weekOptions, handleWeekChange,
    selectedEntrantId, changeEntrant,
    fixturesKnown, teamsPlaying, playersByTeam, poolLoading,
    team, isEditingTeam, teamDirty, startEditingTeam, cancelEditingTeam, saveTeam,
    handlePlayerChange, handleBackupPositionChange,
    weekFixtures, tips, isEditingTips, tipsDirty, startEditingTips, cancelEditingTips, saveTips,
    handleTipSelect, handleDeadCertToggle,
    entryLocked, isEligibleThisWeek, canEdit, isPastYear,
    bracket, bracketLoading, bracketError, refreshBracket, viewerEliminated,
    loading, error, actionError, saving, successMessage,
  } = useDuzzaFinals(isAdmin ? '' : selectedUserId, { isAdmin });

  const { addToast } = useToast();

  const handleSaveTeam = async () => {
    const ok = await saveTeam();
    addToast(ok ? 'Team saved!' : 'Failed to save team', ok ? 'success' : 'error');
  };

  const handleSaveTips = async () => {
    const ok = await saveTips();
    addToast(ok ? 'Tips saved!' : 'Failed to save tips', ok ? 'success' : 'error');
  };

  if (!selectedUserId && !isAdmin) {
    return (
      <div className="text-center p-10">
        <h2 className="dz-title mb-4">Please Select a Player</h2>
        <p className="dz-subtitle">
          Use the dropdown in the top right to select which player&apos;s Duzza Finals picks you want to view or edit.
        </p>
      </div>
    );
  }

  const currentWeekOption = weekOptions.find((w) => w.round === activeWeek);
  const editTabProps = {
    isAdmin,
    selectedEntrantId,
    fixturesKnown,
    poolLoading,
    entryLocked,
    isEligibleThisWeek,
    isPastYear,
    canEdit,
    saving,
  };

  return (
    <div className="p-4 sm:p-6 w-full mx-auto">
      {/* ===== Header ===== */}
      <div className="hidden md:block">
        <ScoreboardHeader
          eyebrow={currentWeekOption?.display}
          title="Duzza Finals"
        >
          <div className="flex items-center gap-3">
            <select
              value={activeWeek}
              onChange={(e) => handleWeekChange(Number(e.target.value))}
              className="dz-select-dark"
            >
              {weekOptions.map((w) => (
                <option key={w.round} value={w.round}>{w.display}</option>
              ))}
            </select>
            {isAdmin && (
              <select
                value={selectedEntrantId || ''}
                onChange={(e) => changeEntrant(e.target.value)}
                className="dz-select-dark"
              >
                <option value="">Select a player to edit</option>
                {Object.entries(USER_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5 text-[11px] text-slate-400">
            {successMessage && <span className="text-emerald-300">{successMessage}</span>}
            {actionError && <span className="text-red-300">{actionError}</span>}
            {error && <span className="text-red-300">{error}</span>}
          </div>
        </ScoreboardHeader>
      </div>

      <div className="block md:hidden mb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-amber-600">
              {currentWeekOption?.display}
            </div>
            <h1 className="mt-0.5 text-[27px] font-black tracking-[-0.03em] leading-none text-slate-900">
              Duzza Finals
            </h1>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <select
            value={activeWeek}
            onChange={(e) => handleWeekChange(Number(e.target.value))}
            className="dz-select w-full"
          >
            {weekOptions.map((w) => (
              <option key={w.round} value={w.round}>{w.display}</option>
            ))}
          </select>
          {isAdmin && (
            <select
              value={selectedEntrantId || ''}
              onChange={(e) => changeEntrant(e.target.value)}
              className="dz-select w-full"
            >
              <option value="">Select a player to edit</option>
              {Object.entries(USER_NAMES).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
        </div>
        {successMessage && (
          <div className="mt-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 p-2.5 text-xs font-medium">
            {successMessage}
          </div>
        )}
        {(actionError || error) && (
          <div className="mt-2 rounded-xl bg-red-50 border border-red-200 text-red-700 p-2.5 text-xs font-medium">
            {actionError || error}
          </div>
        )}
      </div>

      {/* ===== Eliminated banner ===== */}
      {viewerEliminated && (
        <div className="mb-4 rounded-xl bg-slate-100 border border-slate-300 text-slate-600 p-3 text-sm font-medium text-center">
          You&apos;ve been knocked out of Duzza Finals — you can still watch it play out.
        </div>
      )}

      {/* ===== Tabs ===== */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== Tab content ===== */}
      {loading && !bracket ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="dz-surface p-4 h-16 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          {activeTab === 'team' && (
            <MyTeamTab
              {...editTabProps}
              teamsPlaying={teamsPlaying}
              playersByTeam={playersByTeam}
              team={team}
              isEditingTeam={isEditingTeam}
              teamDirty={teamDirty}
              startEditingTeam={startEditingTeam}
              cancelEditingTeam={cancelEditingTeam}
              saveTeam={handleSaveTeam}
              handlePlayerChange={handlePlayerChange}
              handleBackupPositionChange={handleBackupPositionChange}
            />
          )}
          {activeTab === 'tips' && (
            <TipsTab
              {...editTabProps}
              weekFixtures={weekFixtures}
              tips={tips}
              isEditingTips={isEditingTips}
              tipsDirty={tipsDirty}
              startEditingTips={startEditingTips}
              cancelEditingTips={cancelEditingTips}
              saveTips={handleSaveTips}
              handleTipSelect={handleTipSelect}
              handleDeadCertToggle={handleDeadCertToggle}
            />
          )}
          {activeTab === 'bracket' && (
            <BracketTab
              bracket={bracket}
              bracketLoading={bracketLoading}
              bracketError={bracketError}
              viewerUserId={!isAdmin ? selectedUserId : null}
              onRefresh={refreshBracket}
            />
          )}
        </>
      )}
    </div>
  );
}

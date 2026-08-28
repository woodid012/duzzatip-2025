'use client';

export default function TipsTab({
  isAdmin,
  selectedEntrantId,
  fixturesKnown,
  poolLoading,
  weekFixtures,
  tips,
  isEditingTips,
  tipsDirty,
  canEdit,
  entryLocked,
  isEligibleThisWeek,
  isPastYear,
  startEditingTips,
  cancelEditingTips,
  saveTips,
  handleTipSelect,
  handleDeadCertToggle,
  saving,
}) {
  if (!selectedEntrantId) {
    return (
      <div className="dz-surface p-6 text-center text-slate-500">
        {isAdmin ? 'Select a player above to view or edit their tips.' : 'Select a player to continue.'}
      </div>
    );
  }

  if (!poolLoading && !fixturesKnown) {
    return (
      <div className="dz-surface p-8 text-center">
        <div className="text-3xl mb-2">🏉</div>
        <h3 className="dz-title mb-1">Fixtures not locked in yet</h3>
        <p className="dz-subtitle">Fixtures for this week aren&apos;t locked in yet — check back closer to game day.</p>
      </div>
    );
  }

  if (!isAdmin && !isEligibleThisWeek) {
    return (
      <div className="dz-surface p-6 text-center text-slate-500">
        You weren&apos;t alive for this week of Duzza Finals.
      </div>
    );
  }

  const deadCertCount = weekFixtures.filter((f) => tips[f.MatchNumber]?.deadCert).length;

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-xs text-slate-500">
          {deadCertCount > 0 && (
            <span className="font-semibold text-amber-600">⭐ {deadCertCount} dead cert{deadCertCount > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEditingTips ? (
            <>
              <button
                onClick={saveTips}
                disabled={saving || !tipsDirty}
                className="dz-btn-primary bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Tips'}
              </button>
              <button onClick={cancelEditingTips} className="dz-btn-ghost">Cancel</button>
            </>
          ) : (
            <button
              onClick={startEditingTips}
              disabled={!canEdit}
              className={`dz-btn ${canEdit ? 'dz-btn-primary' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
            >
              {isPastYear ? 'Read only' : entryLocked && !isAdmin ? 'Locked' : 'Edit Tips'}
            </button>
          )}
        </div>
      </div>

      {entryLocked && !isAdmin && (
        <div className="rounded-xl bg-slate-100 border border-slate-200 text-slate-600 p-3 text-sm font-medium">
          🔒 This week is locked — the first game has bounced. Your tips are final for this week.
        </div>
      )}

      {weekFixtures.length === 0 && (
        <div className="dz-surface p-6 text-center text-slate-500">No games found for this week yet.</div>
      )}

      {weekFixtures.map((fixture) => {
        const gameHasResult = fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
        const winner = gameHasResult
          ? (fixture.HomeTeamScore > fixture.AwayTeamScore ? fixture.HomeTeam
             : fixture.AwayTeamScore > fixture.HomeTeamScore ? fixture.AwayTeam
             : 'Draw')
          : null;
        const tipTeam = tips[fixture.MatchNumber]?.team;
        const deadCert = tips[fixture.MatchNumber]?.deadCert;
        const isCorrectTip = gameHasResult && winner !== 'Draw' && tipTeam === winner;
        const isWrongTip = gameHasResult && winner !== 'Draw' && tipTeam !== winner;
        const pickClass = (team) => `p-3 rounded-[13px] text-sm transition-colors min-w-0 border ${
          tipTeam === team
            ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-900'
        } ${!isEditingTips ? 'cursor-not-allowed opacity-60' : ''}`;

        return (
          <div key={fixture.MatchNumber} className="rounded-[18px] border border-slate-200 bg-white shadow-sm p-3">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-[11px] font-semibold text-slate-500">
                Game {fixture.MatchNumber} · {fixture.DateMelb}
              </div>
              {isCorrectTip && <span className="text-emerald-600 font-bold text-lg leading-none">✓</span>}
              {isWrongTip && <span className="text-red-600 font-bold text-lg leading-none">✗</span>}
              {gameHasResult && winner === 'Draw' && <span className="text-slate-500 text-[11px] font-semibold">Draw</span>}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <button
                onClick={() => handleTipSelect(fixture.MatchNumber, fixture.HomeTeam)}
                type="button"
                disabled={!isEditingTips}
                className={pickClass(fixture.HomeTeam)}
              >
                <div className="text-center min-w-0">
                  <div className="font-extrabold truncate">{fixture.HomeTeam}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] opacity-75">
                    Home{gameHasResult ? ` · ${fixture.HomeTeamScore}` : ''}
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleTipSelect(fixture.MatchNumber, fixture.AwayTeam)}
                type="button"
                disabled={!isEditingTips}
                className={pickClass(fixture.AwayTeam)}
              >
                <div className="text-center min-w-0">
                  <div className="font-extrabold truncate">{fixture.AwayTeam}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] opacity-75">
                    Away{gameHasResult ? ` · ${fixture.AwayTeamScore}` : ''}
                  </div>
                </div>
              </button>
            </div>

            <div className="flex justify-between items-center gap-2">
              <div className="text-[11px] min-w-0">
                <span className="text-slate-500">Your tip:</span>
                <span className="font-bold ml-1 text-slate-900">{tipTeam || 'Not selected'}</span>
              </div>
              <button
                onClick={() => handleDeadCertToggle(fixture.MatchNumber)}
                type="button"
                disabled={!isEditingTips || !tipTeam}
                className={`px-3 py-1 rounded-full text-[11px] font-extrabold shrink-0 border ${
                  deadCert
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : 'bg-white border-slate-200 text-slate-600'
                } ${(!isEditingTips || !tipTeam) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-50'}`}
              >
                {deadCert ? '⭐ Dead Cert' : 'Dead Cert'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

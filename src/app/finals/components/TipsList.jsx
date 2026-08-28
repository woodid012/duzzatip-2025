'use client';

import { formatMelbDate } from '../lib/format';

// One card per fixture: team pick buttons + dead-cert toggle. `tips` is
// { [matchNumber]: { team, deadCert } }.
export default function TipsList({ fixtures, tips, onTipSelect, onDeadCertToggle, disabled }) {
  if (!fixtures || fixtures.length === 0) {
    return <div className="dz-surface p-6 text-center text-slate-500">No games found for this week yet.</div>;
  }

  return (
    <div className="space-y-3">
      {fixtures.map((fixture) => {
        const gameHasResult =
          fixture.HomeTeamScore !== null && fixture.HomeTeamScore !== undefined &&
          fixture.AwayTeamScore !== null && fixture.AwayTeamScore !== undefined;
        const winner = gameHasResult
          ? (fixture.HomeTeamScore > fixture.AwayTeamScore ? fixture.HomeTeam
             : fixture.AwayTeamScore > fixture.HomeTeamScore ? fixture.AwayTeam
             : 'Draw')
          : null;
        const tipTeam = tips[fixture.MatchNumber]?.team;
        const deadCert = tips[fixture.MatchNumber]?.deadCert;
        const isCorrect = gameHasResult && winner !== 'Draw' && tipTeam === winner;
        const isWrong = gameHasResult && winner !== 'Draw' && tipTeam && tipTeam !== winner;

        const pickClass = (team) => `p-3 rounded-[13px] text-sm transition-colors min-w-0 border ${
          tipTeam === team
            ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-900'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`;

        return (
          <div key={fixture.MatchNumber} className="rounded-[18px] border border-slate-200 bg-white shadow-sm p-3">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-[11px] font-semibold text-slate-500">
                Game {fixture.MatchNumber} · {formatMelbDate(fixture.DateUtc)}
              </div>
              {isCorrect && <span className="text-emerald-600 font-bold text-lg leading-none">✓</span>}
              {isWrong && <span className="text-red-600 font-bold text-lg leading-none">✗</span>}
              {gameHasResult && winner === 'Draw' && <span className="text-slate-500 text-[11px] font-semibold">Draw</span>}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <button
                type="button"
                onClick={() => onTipSelect(fixture.MatchNumber, fixture.HomeTeam)}
                disabled={disabled}
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
                type="button"
                onClick={() => onTipSelect(fixture.MatchNumber, fixture.AwayTeam)}
                disabled={disabled}
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
                type="button"
                onClick={() => onDeadCertToggle(fixture.MatchNumber)}
                disabled={disabled || !tipTeam}
                className={`px-3 py-1 rounded-full text-[11px] font-extrabold shrink-0 border ${
                  deadCert ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-600'
                } ${(disabled || !tipTeam) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-50'}`}
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

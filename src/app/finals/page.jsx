'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFinalsAuth } from './context';
import useFinalsResults from './lib/useFinalsResults';
import AuthForms from './components/AuthForms';
import InstallApp from './components/InstallApp';
import { claimFirstOpen } from './lib/firstOpen';
import { isWeekInProgress } from './lib/roundStatus';
import { FINALS_ROUNDS, FALLBACK_WEEK_LABELS, WEEK_DATE_HINTS, weekNumberForRound } from './lib/constants';

const POSITION_ROWS = [
  { name: 'Full Forward', formula: 'Goals × 9 + Behinds × 1' },
  { name: 'Tall Forward', formula: 'Goals × 6 + Marks × 2' },
  { name: 'Offensive', formula: 'Goals × 7 + Kicks × 1' },
  { name: 'Midfielder', formula: 'First 30 disposals × 1, every disposal beyond 30 × 3' },
  { name: 'Tackler', formula: 'Tackles × 4 + Handballs × 1' },
  { name: 'Ruck', formula: 'Hitouts + Marks × 1, up to 18 combined — every mark beyond that cap × 3' },
];

export default function FinalsHomePage() {
  const router = useRouter();
  const { entrantId, name, loading: authLoading } = useFinalsAuth();
  const { data: results, loading: resultsLoading } = useFinalsResults();

  const currentWeek = results?.currentWeek ?? FINALS_ROUNDS[0];
  const currentWeekApiWeek = (results?.weeks || []).find((w) => w.round === currentWeek);
  const currentWeekLabel = currentWeekApiWeek?.label || FALLBACK_WEEK_LABELS[currentWeek];

  // Rules is the app's landing page, but it's a one-pager you read once —
  // mid-round, live scores are what you opened the app for. Forward the
  // session's opening screen to Results while the week is being played.
  // Claimed on mount (before the layout's own claim) so this only ever fires
  // when Rules IS the opening screen: clicking Rules later still shows Rules.
  // Signed-out visitors stay put — registering starts here.
  const ownsFirstOpen = useRef(null);
  useEffect(() => {
    if (ownsFirstOpen.current === null) ownsFirstOpen.current = claimFirstOpen();
  }, []);
  useEffect(() => {
    if (!ownsFirstOpen.current || authLoading || entrantId == null) return;
    if (!isWeekInProgress(currentWeekApiWeek)) return;
    ownsFirstOpen.current = false;
    router.replace('/finals/results');
  }, [router, authLoading, entrantId, currentWeekApiWeek]);

  return (
    <div className="space-y-10 pb-10">
      {/* ===== Hero ===== */}
      <section className="text-center pt-2 sm:pt-6">
        <div className="text-4xl mb-3">🏆</div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900">Duzza Finals</h1>
        <p className="mt-2 text-sm sm:text-base text-slate-500 max-w-xl mx-auto">
          A free-to-enter AFL fantasy comp over the 2026 finals series. Pick a new team every
          week from the squads still alive, tip every game, and rack up the highest 4-week total
          to top the open ladder.
        </p>

        {!authLoading && entrantId != null && (
          <div className="mt-6 inline-flex flex-col items-center gap-2">
            <div className="dz-surface px-5 py-4 flex flex-col sm:flex-row items-center gap-3">
              <span className="text-sm text-slate-600">
                You&apos;re in as <span className="font-bold text-slate-900">{name}</span> — enter your team for{' '}
                <span className="font-bold text-slate-900">
                  Week {weekNumberForRound(currentWeek)}{currentWeekLabel ? ` · ${currentWeekLabel}` : ''}
                </span>
              </span>
              <Link href="/finals/enter" className="dz-btn-primary shrink-0">Enter your team →</Link>
            </div>
          </div>
        )}
      </section>

      {/* ===== How it works ===== */}
      <Section title="How it works" emoji="🗓️">
        <p>
          Duzza Finals runs over four weeks of the AFL finals series (the wildcard round doesn&apos;t
          count). Every week, every entrant picks a full fantasy team from the <strong>full squads</strong>{' '}
          of the clubs playing that week — the player pool shrinks as clubs get knocked out, and
          picking the same player as someone else is totally fine. You also tip every game that
          week, with the option to back a pick as a dead cert.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="dz-table w-full">
            <thead>
              <tr>
                <th>Week</th>
                <th>Round</th>
                <th>Games</th>
                <th className="text-right">Dates</th>
              </tr>
            </thead>
            <tbody>
              {FINALS_ROUNDS.map((round) => {
                const apiWeek = (results?.weeks || []).find((w) => w.round === round);
                const label = apiWeek?.label || FALLBACK_WEEK_LABELS[round];
                const dateHint = WEEK_DATE_HINTS[round];
                const fixturesKnown = apiWeek?.fixturesKnown;
                return (
                  <tr key={round}>
                    <td className="font-semibold text-slate-900">Week {weekNumberForRound(round)}</td>
                    <td>{label}</td>
                    <td>
                      {resultsLoading ? (
                        <span className="text-slate-400">…</span>
                      ) : fixturesKnown === false ? (
                        <span className="dz-badge bg-slate-100 text-slate-500">Fixtures TBC</span>
                      ) : (
                        <span className="text-slate-600">
                          {round === 26 ? '4 games' : fixturesKnown ? 'confirmed' : '—'}
                        </span>
                      )}
                    </td>
                    <td className="text-right text-slate-500">{dateHint || 'TBC'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ===== Picking your team ===== */}
      <Section title="Picking your team" emoji="🧢">
        <p>
          Six scoring positions, each rewarding a different kind of performance. Pick one player
          per position from the pool of clubs playing that week:
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="dz-table w-full">
            <thead>
              <tr>
                <th>Position</th>
                <th>Scoring</th>
              </tr>
            </thead>
            <tbody>
              {POSITION_ROWS.map((p) => (
                <tr key={p.name}>
                  <td className="font-semibold text-slate-900">{p.name}</td>
                  <td className="text-slate-600">{p.formula}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600">
            <div className="font-bold text-slate-900 mb-1">Bench</div>
            Nominate one of the six positions to back up. If your bench player outscores that
            position&apos;s starter, they automatically swap in for the round.
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600">
            <div className="font-bold text-slate-900 mb-1">Reserve A &amp; Reserve B</div>
            Reserve A covers Full Forward, Tall Forward and Ruck; Reserve B covers Offensive,
            Midfielder and Tackler — either subs in after the round for a starter who didn&apos;t play.
          </div>
        </div>
      </Section>

      {/* ===== Tips & dead certs ===== */}
      <Section title="Tips &amp; dead certs" emoji="⭐">
        <p>
          Tip the winner of every game that week. Ordinary tips are tracked for bragging rights
          but score 0. You can back any one tip per game as a <strong>dead cert</strong>: get it right
          for <strong className="text-emerald-600">+6</strong>, get it wrong and it costs you{' '}
          <strong className="text-red-600">−12</strong>. Your weekly score is your team score plus
          your dead cert score.
        </p>
      </Section>

      {/* ===== Lockout ===== */}
      <Section title="Lockout" emoji="🔒">
        <p>
          Everything locks at the first bounce of each week — team and tips both. Before lockout
          you can only see your own picks; everyone else&apos;s team is revealed once the round locks.
          Until the AFL confirms a round&apos;s matchups, that week shows as <strong>&ldquo;fixtures TBC&rdquo;</strong> and
          picks can&apos;t be entered yet.
        </p>
      </Section>

      {/* ===== Ladder vs knockout ===== */}
      <Section title="How you win" emoji="🏅">
        <p>
          Open entrants (that&apos;s you) compete on the <strong>4-week cumulative ladder</strong> — add up
          your score across all four weeks, and the highest total when the Grand Final wraps up
          takes it out. Separately, the eight core league members also run a knockout bracket
          (bottom two cut each week, head-to-head in the Grand Final) — that&apos;s their own side
          contest and doesn&apos;t affect the open ladder at all.
        </p>
      </Section>

      {/* ===== Register / Login ===== */}
      {!authLoading && entrantId == null && (
        <section id="join">
          <h2 className="text-xl font-bold text-slate-900 text-center mb-1">Get in on it</h2>
          <p className="text-sm text-slate-500 text-center mb-5">It&apos;s free — register a team name and you&apos;re playing.</p>
          <AuthForms />
        </section>
      )}

      {/* ===== Install the app ===== */}
      <Section title="Install the app" emoji="📲">
        <InstallApp />
      </Section>
    </div>
  );
}

function Section({ title, emoji, children }) {
  return (
    <section className="dz-surface p-5 sm:p-6">
      <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
        {emoji && <span>{emoji}</span>}
        {title}
      </h2>
      <div className="text-sm text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

// src/app/lib/duzzaFinalsAutoPick.js
//
// Pure, DB-free helpers shared by the Duzza Finals auto-pick feature — a
// PERSONAL automation that only ever runs for Entrant 4 (Le Quack Attack,
// DEFAULT_USER in lockout-notify.js). It extends the existing season
// auto-picker (lockout-notify.js CLI + src/app/api/lockout-notify/route.js)
// so user 4 also gets an optimised team + default tips submitted for the
// Duzza Finals side comp (rounds 26-29), written to the separate
// `duzza_finals` Mongo database (see connectToFinalsDatabase in mongodb.js).
//
// CommonJS on purpose (module.exports), same reasoning as lockoutShared.js:
// the plain-Node lockout-notify.js CLI can `require()` this directly, and the
// Next.js /api/lockout-notify route can `import` it via CJS interop. That
// means it CANNOT depend on `@/...`-aliased ESM files (src/app/lib/duzzaFinals.js,
// fixtureCache.js, etc.) — those only resolve under webpack/Next, not plain
// Node. The small set of finals constants below are therefore a DELIBERATE
// mirror of src/app/lib/duzzaFinals.js — keep them in sync (same convention
// already used for SCORE_FNS/MAIN_POSITIONS between lockout-notify.js and
// src/app/lib/lineupOptimiser.js).
//
// Position/scoring logic itself is NOT duplicated here — every function below
// is parameterised (positions, keepNames, etc.) so it can be reused by both
// the CLI's own findOptimalLineup and the route's optimiseLineup() without
// this file needing to know the scoring formulas at all.

// Mirror of src/app/lib/duzzaFinals.js — keep in sync.
const DUZZA_FINALS_ROUNDS = [26, 27, 28, 29];
const DUZZA_FINALS_WEEK_LABELS = {
  26: 'Qualifying & Elimination Finals',
  27: 'Semi Finals',
  28: 'Preliminary Finals',
  29: 'Grand Final',
};
// Mirror of src/app/lib/duzzaFinals.js:DUZZA_FINALS_ABBREV_TO_FULL — keep in sync.
const DUZZA_FINALS_ABBREV_TO_FULL = {
  ADE: 'Adelaide Crows', ADEL: 'Adelaide Crows',
  BRL: 'Brisbane Lions', BL: 'Brisbane Lions',
  CAR: 'Carlton', CARL: 'Carlton',
  COL: 'Collingwood', COLL: 'Collingwood',
  ESS: 'Essendon',
  FRE: 'Fremantle',
  GEE: 'Geelong Cats', GEEL: 'Geelong Cats',
  GCS: 'Gold Coast SUNS', GCFC: 'Gold Coast SUNS',
  GWS: 'GWS GIANTS',
  HAW: 'Hawthorn',
  MEL: 'Melbourne', MELB: 'Melbourne',
  NTH: 'North Melbourne', NMFC: 'North Melbourne',
  PTA: 'Port Adelaide', PORT: 'Port Adelaide',
  RIC: 'Richmond', RICH: 'Richmond',
  STK: 'St Kilda',
  SYD: 'Sydney Swans',
  WCE: 'West Coast Eagles',
  WBD: 'Western Bulldogs', WB: 'Western Bulldogs',
};

function isDuzzaFinalsRound(round) {
  return DUZZA_FINALS_ROUNDS.includes(Number(round));
}

// Which of DUZZA_FINALS_ROUNDS is "current" — the earliest round with an
// upcoming (not yet started) fixture, else the latest round we have any
// fixture data for at all. Mirrors lockout-notify.js's getCurrentRound(), but
// scoped to whichever finals rounds actually have fixtures synced into
// `${year}_fixtures` (a round can be a placeholder with zero rows until an
// earlier round decides it). Returns null when NO finals round has any
// fixture yet (nothing synced/decided) — callers should treat that as
// "nothing to do yet", not an error.
function getFinalsCurrentRound(finalsFixtures, roundsList = DUZZA_FINALS_ROUNDS) {
  if (!finalsFixtures || !finalsFixtures.length) return null;
  const known = roundsList.filter(r => finalsFixtures.some(f => Number(f.RoundNumber) === r));
  if (!known.length) return null;
  const now = new Date();
  const upcoming = finalsFixtures.filter(
    f => roundsList.includes(Number(f.RoundNumber)) && new Date(f.DateUtc) > now
  );
  if (!upcoming.length) return Math.max(...known);
  return Math.min(...upcoming.map(f => Number(f.RoundNumber)));
}

// CLI-only equivalent of duzzaFinals.js's derivePlayerPool(), flattened to a
// plain candidate list rather than grouped by club. Only exists because the
// CJS CLI can't import that ESM module — the Next.js route uses the real
// getPlayerPoolForRound()/derivePlayerPool() instead (see route.js) and never
// calls this. `players` is `${year}_players` docs {player_name, team_name}
// (team_name is the 3-letter club abbrev); `roundFixtures` is that round's
// rows from `${year}_fixtures` (HomeTeam/AwayTeam full club names).
function deriveFinalsCandidatePlayers(players, roundFixtures) {
  const realClubNames = new Set(Object.values(DUZZA_FINALS_ABBREV_TO_FULL));
  const teamsPlaying = new Set();
  for (const f of roundFixtures || []) {
    if (realClubNames.has(f.HomeTeam)) teamsPlaying.add(f.HomeTeam);
    if (realClubNames.has(f.AwayTeam)) teamsPlaying.add(f.AwayTeam);
  }
  const out = [];
  for (const p of players || []) {
    const full = DUZZA_FINALS_ABBREV_TO_FULL[p.team_name];
    if (full && teamsPlaying.has(full)) out.push({ name: p.player_name, team: p.team_name });
  }
  return out;
}

// Prunes a scored candidate pool (~350 players for a finals round, vs the
// usual ~30-man squad) down to a size the joint bench optimiser
// (findOptimalLineup / optimiseLineup, O(pool² × 2^positions) in the worst
// case) can still solve quickly: the top `topN` candidates by projected mean
// at EACH main position (union across positions — a gun midfielder who also
// projects well at Tackler is only counted once), plus anyone in `keepNames`
// (e.g. a player the automation itself already picked for this round on a
// prior run — see the no-clobber rule in lockout-notify.js/route.js) so a
// pick already saved doesn't get silently swapped out just because a stats
// update nudged them out of the top N. With 6 positions × topN=12 this keeps
// the pool to roughly 40-70 unique players (heavy overlap between positions
// in practice), well within what the optimiser handles in well under a
// second.
function pruneFinalsCandidates(pool, { positions, topN = 12, keepNames = new Set() } = {}) {
  const kept = new Map();
  for (const pos of positions) {
    const ranked = pool
      .filter(p => (p.scores?.[pos] || 0) > 0)
      .sort((a, b) => (b.scores[pos] || 0) - (a.scores[pos] || 0))
      .slice(0, topN);
    for (const p of ranked) kept.set(p.name, p);
  }
  for (const p of pool) {
    if (keepNames.has(p.name)) kept.set(p.name, p);
  }
  return [...kept.values()];
}

// Maps an optimiser result — {lineup:{pos:player}, bench, benchBackup,
// reserveA, reserveB}, the shape both findOptimalLineup() (CLI) and
// optimiseLineup() (route) return, where each player is {name, team} with
// `team` already the 3-letter club abbrev — into the duzza_finals entry
// Team doc shape consumed by src/app/api/duzza-finals/entry/route.js:
//   {'Full Forward': {player, club}, ..., Bench: {player, club, backup_position},
//    'Reserve A': {player, club}, 'Reserve B': {player, club}}
function buildFinalsTeamDoc(result, positions) {
  const team = {};
  for (const pos of positions) {
    const p = result.lineup[pos];
    if (p) team[pos] = { player: p.name, club: p.team };
  }
  if (result.bench) {
    team.Bench = { player: result.bench.name, club: result.bench.team, backup_position: result.benchBackup };
  }
  if (result.reserveA) team['Reserve A'] = { player: result.reserveA.name, club: result.reserveA.team };
  if (result.reserveB) team['Reserve B'] = { player: result.reserveB.name, club: result.reserveB.team };
  return team;
}

// Maps a tips-by-match-number object ({matchNumber: {team, deadCert}} — the
// same shape lockout-notify.js/route.js build from tipSuggestions) into the
// duzza_finals entry Tips array shape: [{MatchNumber, Match, Tip, DeadCert}].
// `roundFixtures` supplies the "Home v Away" Match label the entry route
// itself would have generated. Callers doing the UNATTENDED default-fill
// (rather than a human editing an interactive session) must force every
// deadCert to false before calling this — auto-picked finals tips never
// carry a dead cert (a knockout comp's dead-cert swing is too consequential
// to set unattended).
function buildFinalsTipsDoc(tipsByMatchNumber, roundFixtures) {
  const byMatchNumber = new Map((roundFixtures || []).map(f => [Number(f.MatchNumber), f]));
  return Object.entries(tipsByMatchNumber || {}).map(([matchNumStr, tip]) => {
    const matchNumber = Number(matchNumStr);
    const fixture = byMatchNumber.get(matchNumber);
    const match = fixture ? `${fixture.HomeTeam} v ${fixture.AwayTeam}` : null;
    return { MatchNumber: matchNumber, Match: match, Tip: tip.team, DeadCert: Boolean(tip.deadCert) };
  });
}

module.exports = {
  DUZZA_FINALS_ROUNDS,
  DUZZA_FINALS_WEEK_LABELS,
  DUZZA_FINALS_ABBREV_TO_FULL,
  isDuzzaFinalsRound,
  getFinalsCurrentRound,
  deriveFinalsCandidatePlayers,
  pruneFinalsCandidates,
  buildFinalsTeamDoc,
  buildFinalsTipsDoc,
};

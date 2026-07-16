/**
 * DuzzaTip lineup + bench optimiser.
 *
 * How the bench actually scores (see src/app/lib/scoreCalculations.js):
 *   - The bench backs up exactly ONE position. At scoring time the engine
 *     awards max(starter, bench) for that position — the swap is automatic,
 *     so the bench is a free option on the starter, not a spare.
 *   - If the starter doesn't play at all, the bench covers that position
 *     ahead of the reserves (who otherwise cover the group at round end).
 *
 * Objective — expected team total for a (starters, bench@backupPos) choice:
 *
 *   E[total] = Σ_pos E[starter_pos]
 *            + (1 − pDNP) · E[(bench_bp − starter_bp)+]    ← option value
 *            + pDNP · (E[bench_bp] − reserveCover_bp)      ← DNP margin over
 *                                                            the reserve who
 *                                                            would otherwise
 *                                                            cover the slot
 *
 * The option value is computed from real per-game scores over every
 * (bench game × starter game) pair, so variance is priced automatically: an
 * all-or-nothing Midfielder/Tackler starter is exactly where E[(bench −
 * starter)+] is large even when the bench's MEAN edge is zero, while a flat
 * +5 mean edge at a steady position is worth ≈5 and no more. The DNP term is
 * only the bench's edge over the reserve cover, weighted by the starter's
 * no-show risk — NOT the bench's full score, which would double-count cover
 * the reserves already provide and drag the backup toward whatever position
 * the bench player's own mean is highest at.
 *
 * Starters and bench are optimised JOINTLY: for every (candidate, backup
 * position) pair the assignment DP is re-solved with the option value folded
 * into that position's payoff, and the combination with the highest expected
 * total wins. The old flow picked starters by means alone and the bench from
 * the leftovers, which could strand option value.
 *
 * lockout-notify.js (CommonJS CLI) mirrors this module — keep them in sync.
 */

const r1 = (v) => Math.round(v * 10) / 10;

// Any named starter can still be a late out; doubts/emergencies much more so.
export const DNP_RISK_BASE    = 0.03;
export const DNP_RISK_FLAGGED = 0.25;

// Below this many sampled games (for either player) the pairwise option value
// is too noisy — fall back to the blended season-score edge.
export const BENCH_MIN_GAMES = 3;

function popcount(n) { let c = 0; while (n) { n &= n - 1; c++; } return c; }

// Exact max-weight assignment of players to positions: DP over a bitmask of
// filled positions, O(players × 2^positions). `payoff(player, pos)` supplies
// the value of starting `player` at `pos` (defaults to the mean projection).
export function optimalAssignment(pool, positions, payoff = (p, pos) => p.scores[pos] || 0) {
  const P = positions.length;
  const FULL = (1 << P) - 1;
  let dp = new Map([[0, { score: 0, assign: {} }]]);
  for (const player of pool) {
    const next = new Map(dp);
    for (const [mask, state] of dp) {
      for (let i = 0; i < P; i++) {
        const bit = 1 << i;
        if (mask & bit) continue;
        const nmask = mask | bit;
        const nscore = state.score + payoff(player, positions[i]);
        const cur = next.get(nmask);
        if (!cur || nscore > cur.score) {
          next.set(nmask, { score: nscore, assign: { ...state.assign, [positions[i]]: player } });
        }
      }
    }
    dp = next;
  }
  // Prefer a fully-filled lineup; otherwise the most-filled, highest-scoring
  // one (happens only when there are fewer eligible players than positions).
  let best = dp.get(FULL);
  if (!best) {
    best = [...dp.entries()]
      .sort(([am, a], [bm, b]) => popcount(bm) - popcount(am) || b.score - a.score)[0]?.[1]
      || { score: 0, assign: {} };
  }
  return { assign: best.assign, score: best.score, used: new Set(Object.values(best.assign).map(p => p.name)) };
}

// Score a single game's stat line at a position with the caller's formulas.
export function scoreGame(game, pos, scoreFns) {
  const s = {
    kicks:     Number(game.kicks)     || 0,
    handballs: Number(game.handballs) || 0,
    marks:     Number(game.marks)     || 0,
    tackles:   Number(game.tackles)   || 0,
    hitouts:   Number(game.hitouts)   || 0,
    goals:     Number(game.goals)     || 0,
    behinds:   Number(game.behinds)   || 0,
  };
  return scoreFns[pos](s);
}

// E[(bench − starter)+] over every game-pair — the exact expected uplift of
// the automatic "score the better of the two" bench rule, treating the two
// players' games as independent draws from their samples.
export function expectedBenchGain(benchScores, starterScores) {
  if (!benchScores?.length || !starterScores?.length) return 0;
  let total = 0;
  for (const b of benchScores) for (const s of starterScores) total += Math.max(b - s, 0);
  return total / (benchScores.length * starterScores.length);
}

/**
 * @param {object[]} squad          players: { name, scores: {pos: mean}, ... }
 * @param {Set}      excluded       names to leave out entirely
 * @param {object}   statsMap       name → { games: [statLine, ...] }
 * @param {object}   scoreFns       pos → (stats) => points
 * @param {string[]} positions      the main positions to fill
 * @param {string[]} reserveACovers / reserveBCovers  reserve group positions
 * @param {function} riskOf         (player) => P(late out), e.g. injury doubts
 */
export function optimiseLineup({
  squad, excluded = new Set(), statsMap = {}, scoreFns,
  positions, reserveACovers, reserveBCovers,
  riskOf = () => DNP_RISK_BASE,
  benchMinGames = BENCH_MIN_GAMES,
}) {
  const eligible = squad.filter(p => !excluded.has(p.name));
  const scoredPool = eligible.filter(p => Object.keys(p.scores || {}).length > 0);

  // No scores at all (pre-season): fill by squad order so all slots are set.
  if (scoredPool.length === 0) {
    const used = new Set(); const assigned = {};
    for (const pos of positions) {
      const p = eligible.find(x => !used.has(x.name));
      if (!p) break;
      assigned[pos] = p; used.add(p.name);
    }
    const leftover = () => eligible.filter(p => !used.has(p.name));
    const bench = leftover()[0] || null;
    if (bench) used.add(bench.name);
    const reserveA = leftover()[0] || null;
    if (reserveA) used.add(reserveA.name);
    const reserveB = leftover()[0] || null;
    return { lineup: assigned, bench, benchBackup: positions[0], benchExpectedGain: 0, benchOptions: [], reserveA, reserveB };
  }

  const pool = scoredPool;

  // Per-game position scores, computed once for the pairwise option values.
  const gameScores = new Map();
  for (const p of pool) {
    const games = statsMap[p.name]?.games || [];
    const byPos = {};
    for (const pos of positions) byPos[pos] = games.map(g => scoreGame(g, pos, scoreFns));
    gameScores.set(p.name, byPos);
  }

  const gainMemo = new Map();
  const gainFor = (candidate, starter, pos) => {
    const key = `${candidate.name}|${starter.name}|${pos}`;
    let g = gainMemo.get(key);
    if (g !== undefined) return g;
    const cg = gameScores.get(candidate.name)?.[pos] || [];
    const sg = gameScores.get(starter.name)?.[pos] || [];
    if (cg.length >= benchMinGames && sg.length >= benchMinGames) {
      g = expectedBenchGain(cg, sg);
    } else {
      // Thin sample — judge the bench on the same blended season scores as
      // the rest of the team (no variance information available).
      g = Math.max((candidate.scores[pos] || 0) - (starter.scores[pos] || 0), 0);
    }
    gainMemo.set(key, g);
    return g;
  };

  // Expected value of benching `cand` behind `bp` given a starter assignment.
  const comboValue = (cand, bp, assign, usedSet, rest) => {
    const starter = assign[bp];
    if (!starter) return null;
    const meanTotal = positions.reduce((t, pos) => t + (assign[pos]?.scores[pos] || 0), 0);
    const p = riskOf(starter);
    const gain = gainFor(cand, starter, bp);
    const leftover = rest.filter(x => !usedSet.has(x.name));
    const reserveCover = Math.max(0, ...leftover.map(x => x.scores[bp] || 0));
    const dnp = p * ((cand.scores[bp] || 0) - reserveCover);
    return { meanTotal, gain, dnp, total: meanTotal + (1 - p) * gain + dnp };
  };

  // Baseline (means only) — the lineup when there's no one left to bench.
  const base = optimalAssignment(pool, positions);

  let best = null;
  if (pool.length > positions.length) {
    for (const cand of pool) {
      const rest = pool.filter(p => p.name !== cand.name);
      for (const bp of positions) {
        const { assign, used } = optimalAssignment(rest, positions,
          (p, pos) => (p.scores[pos] || 0) + (pos === bp ? (1 - riskOf(p)) * gainFor(cand, p, bp) : 0));
        const v = comboValue(cand, bp, assign, used, rest);
        if (!v) continue;
        // max(starter, bench) is symmetric, so "A starts / B benches" can tie
        // exactly with the reverse. Break ties toward the higher-mean starters
        // — the pairwise option value is noisier than the season means.
        if (!best || v.total > best.total + 1e-6 ||
            (Math.abs(v.total - best.total) <= 1e-6 && v.meanTotal > best.meanTotal)) {
          best = { cand, bp, assign, used, ...v };
        }
      }
    }
  }

  if (!best) {
    // Too few players to bench anyone: starters only, then whatever is left.
    const leftover = pool.filter(p => !base.used.has(p.name));
    return {
      lineup: base.assign, bench: leftover[0] || null, benchBackup: positions[0],
      benchExpectedGain: 0, benchOptions: [], reserveA: null, reserveB: null,
    };
  }

  const { cand: bench, bp: benchBackup, assign, used } = best;

  // Per-position value of the chosen bench against the chosen starters, so
  // the pick is auditable ("MID +6.2 beat OFF +4.8", not a black box).
  const restPool = pool.filter(p => p.name !== bench.name);
  const benchOptions = positions
    .map(pos => {
      const v = comboValue(bench, pos, assign, used, restPool);
      if (!v) return null;
      return { pos, gain: r1(v.gain), value: r1((1 - riskOf(assign[pos])) * v.gain + v.dnp) };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);

  // Reserves from the remaining pool: best cover for each reserve group.
  const afterBench = restPool.filter(p => !used.has(p.name));
  const resAScore = p => Math.max(0, ...reserveACovers.map(pos => p.scores[pos] || 0));
  const reserveA = [...afterBench].sort((a, b) => resAScore(b) - resAScore(a))[0] || null;
  const afterA = afterBench.filter(p => p.name !== reserveA?.name);
  const resBScore = p => Math.max(0, ...reserveBCovers.map(pos => p.scores[pos] || 0));
  const reserveB = [...afterA].sort((a, b) => resBScore(b) - resBScore(a))[0] || null;

  return {
    lineup: assign,
    bench,
    benchBackup,
    benchExpectedGain: r1(best.gain),
    benchOptions,
    reserveA,
    reserveB,
  };
}

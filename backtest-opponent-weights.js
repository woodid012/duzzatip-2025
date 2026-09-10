#!/usr/bin/env node
// Backtest: does opponent-strength weighting improve Duzza finals player
// projections? Standalone, boring, single file. `node backtest-opponent-weights.js`
//
// Method (see task spec): for each year/round, baseline projection =
// scorePositionsFromGames(history games < round). Weighted projection =
// baseline * opponentMultiplier[opp][pos], multiplier built from a trailing
// window of ALL players' games (not just this player) via
// buildOpponentMultipliers() in src/app/lib/duzzaFinalsAutoPick.js.
//
// ponytail: findOptimalLineup() is O(pool x 2^6) and benchmarks ~400ms for a
// 60-player pool (measured). Running it for all 17 grid configs x ~63
// rounds would take 7+ minutes, well past the 3-minute budget. So metric (c)
// (optimizer-picked lineup actual score) is only computed for baseline vs.
// the single best grid config (picked by pooled pick-quality delta), not
// the whole grid. Upgrade path: cache/parallelize findOptimalLineup, or drop
// pool size, if a full-grid (c) table is ever needed.

require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");
const {
  SCORE_FNS, MAIN_POSITIONS, scoreGame, scorePositionsFromGames, findOptimalLineup,
} = require("./lockout-notify");
const { findTeamSlug } = require("./src/app/lib/lockoutShared");
const { buildOpponentMultipliers, pruneFinalsCandidates } = require("./src/app/lib/duzzaFinalsAutoPick");

const MONGODB_URI = process.env.MONGODB_URI ||
  "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";
const DB_NAME = "afl_database";
const YEARS = [2024, 2025, 2026];
const WINDOWS = [4, 6, 8, "all"];
const SHRINKS = [0.25, 0.5, 0.75, 1.0];
const OPP_MIN_GAMES = 3;
const PLAYER_MIN_HISTORY = 2;
const PRUNE_TOP_N = 12;
const MIN_ROUND = 6;
const LAST_WEEK = { year: 2026, round: 26 };
const ROBUST = process.argv.includes("--robust");
const FIXED_KEY = configKey(4, 0.5); // the config under scrutiny

const FIELDS = { player_name: 1, team_name: 1, opp: 1, round: 1, kicks: 1, handballs: 1,
  marks: 1, tackles: 1, hitouts: 1, goals: 1, behinds: 1, timeOnGroundPercentage: 1, _id: 0 };

function togOk(row) {
  const tog = Number(row.timeOnGroundPercentage);
  return !(Number.isFinite(tog) && tog > 0 && tog < 50); // mirrors loadPlayerStats guard
}

function configKey(window, shrink) { return `${window}|${shrink}`; }

// ── Data loading ─────────────────────────────────────────────────────────
async function loadFixturesMap(db, year) {
  const docs = await db.collection(`${year}_fixtures`)
    .find({}, { projection: { RoundNumber: 1, HomeTeam: 1, AwayTeam: 1, _id: 0 } }).toArray();
  const map = new Map();
  for (const f of docs) {
    const home = findTeamSlug(f.HomeTeam), away = findTeamSlug(f.AwayTeam);
    if (home && away) {
      map.set(`${f.RoundNumber}|${home}`, away);
      map.set(`${f.RoundNumber}|${away}`, home);
    }
  }
  return map;
}

async function loadYear(db, year) {
  const rows = await db.collection(`${year}_game_results`)
    .find({ round: { $gte: 1 } }, { projection: FIELDS }).toArray();
  const fixturesMap = await loadFixturesMap(db, year); // used as fallback when opp is blank (2025)

  const rowsByRound = new Map();
  const playerRows = new Map(); // player -> all rows (unfiltered), for building history
  const seenPlayerRound = new Set();
  for (const row of rows) {
    row._team = findTeamSlug(row.team_name);
    row._opp = (row.opp && findTeamSlug(row.opp)) ||
      (row._team ? fixturesMap.get(`${row.round}|${row._team}`) : null) || null;

    if (!rowsByRound.has(row.round)) rowsByRound.set(row.round, []);
    // dedupe same player appearing twice in the same round
    const dedupeKey = `${row.player_name}|${row.round}`;
    if (!seenPlayerRound.has(dedupeKey)) {
      seenPlayerRound.add(dedupeKey);
      rowsByRound.get(row.round).push(row);
      if (!playerRows.has(row.player_name)) playerRows.set(row.player_name, []);
      playerRows.get(row.player_name).push(row);
    }
  }
  for (const arr of playerRows.values()) arr.sort((a, b) => a.round - b.round);

  const maxRound = Math.max(...rows.map(r => r.round));
  return { rowsByRound, playerRows, maxRound };
}

// ── Per-round context (baseline projections, actuals) — config-independent ─
function buildRoundContext(yearData, R) {
  const roundRows = yearData.rowsByRound.get(R) || [];
  const eligiblePlayers = [];
  const baselineByPlayer = {};
  const actualByPlayer = {};
  const oppByPlayer = {};
  const teamByPlayer = {};

  for (const row of roundRows) {
    const allRows = yearData.playerRows.get(row.player_name) || [];
    const history = allRows.filter(r => r.round < R && togOk(r));
    if (history.length < PLAYER_MIN_HISTORY) continue;
    baselineByPlayer[row.player_name] = scorePositionsFromGames(history);
    actualByPlayer[row.player_name] = row;
    oppByPlayer[row.player_name] = row._opp;
    teamByPlayer[row.player_name] = row.team_name;
    eligiblePlayers.push(row.player_name);
  }
  return { eligiblePlayers, baselineByPlayer, actualByPlayer, oppByPlayer, teamByPlayer };
}

function windowRowsFor(yearData, window, R) {
  const cutoff = window === "all" ? 1 : Math.max(1, R - window);
  const out = [];
  for (let r = cutoff; r < R; r++) {
    const rs = yearData.rowsByRound.get(r);
    if (rs) out.push(...rs);
  }
  return out;
}

function weightedScores(ctx, mult) {
  const out = {};
  for (const name of ctx.eligiblePlayers) {
    const base = ctx.baselineByPlayer[name];
    const opp = ctx.oppByPlayer[name];
    const oppMult = (opp && mult[opp]) || null;
    const scores = {};
    for (const pos of MAIN_POSITIONS) scores[pos] = base[pos] * ((oppMult && oppMult[pos]) || 1);
    out[name] = scores;
  }
  return out;
}

// ── Metrics ──────────────────────────────────────────────────────────────
function accMAE(acc, ctx, scoresByPlayer) {
  for (const name of ctx.eligiblePlayers) {
    const actualRow = ctx.actualByPlayer[name];
    for (const pos of MAIN_POSITIONS) {
      const err = Math.abs(scoresByPlayer[name][pos] - scoreGame(actualRow, pos));
      acc.sumErr += err; acc.errCount++;
    }
  }
}

function pickTop1PerPosition(ctx, scoresByPlayer) {
  const used = new Set();
  const picks = {};
  for (const pos of MAIN_POSITIONS) {
    let best = null, bestScore = -Infinity;
    for (const name of ctx.eligiblePlayers) {
      if (used.has(name)) continue;
      const s = scoresByPlayer[name][pos];
      if (s > bestScore) { bestScore = s; best = name; }
    }
    if (best != null) { picks[pos] = best; used.add(best); }
  }
  return picks;
}

function pickQualityTotal(ctx, picks) {
  let total = 0;
  for (const pos of MAIN_POSITIONS) {
    const name = picks[pos];
    if (!name) continue;
    total += scoreGame(ctx.actualByPlayer[name], pos);
  }
  return total;
}

function optimizerQualityTotal(ctx, scoresByPlayer) {
  const pool = ctx.eligiblePlayers.map(name => ({ name, team: ctx.teamByPlayer[name], scores: scoresByPlayer[name] }));
  const pruned = pruneFinalsCandidates(pool, { positions: MAIN_POSITIONS, topN: PRUNE_TOP_N });
  const result = findOptimalLineup(pruned);
  let total = 0;
  for (const pos of MAIN_POSITIONS) {
    const p = result.lineup[pos];
    if (!p) continue;
    total += scoreGame(ctx.actualByPlayer[p.name], pos);
  }
  return total;
}

// ── --robust helpers (PRNG, exact sign test, bootstrap) ────────────────────
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Exact two-sided binomial sign test, p=0.5, via a stable recurrence on P(X=k).
function binomialCDF(k, n) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let term = Math.pow(0.5, n); // P(X=0)
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= (n - i + 1) / i; // p/(1-p) = 1 at p=0.5
    cdf += term;
  }
  return Math.min(cdf, 1);
}
function signTestP(nPos, n) {
  if (n === 0) return 1;
  const lower = binomialCDF(nPos, n);
  const upper = 1 - binomialCDF(nPos - 1, n);
  return Math.min(1, 2 * Math.min(lower, upper));
}

function bootstrapMeanCI(deltas, rng, B = 2000) {
  const n = deltas.length;
  const boot = new Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += deltas[Math.floor(rng() * n)];
    boot[b] = s / n;
  }
  boot.sort((a, b) => a - b);
  return { lo: boot[Math.floor(0.025 * B)], hi: boot[Math.floor(0.975 * B)] };
}

function newAcc() { return { sumErr: 0, errCount: 0, sumPick: 0, rounds: 0, sumOpt: 0, optRounds: 0 }; }
function mae(acc) { return acc.errCount ? acc.sumErr / acc.errCount : null; }
function meanPick(acc) { return acc.rounds ? acc.sumPick / acc.rounds : null; }
function meanOpt(acc) { return acc.optRounds ? acc.sumOpt / acc.optRounds : null; }

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const configKeys = ["baseline", ...WINDOWS.flatMap(w => SHRINKS.map(s => configKey(w, s)))];
  // results[configKey][year] = acc ; results[configKey].pooled = acc
  const results = {};
  for (const k of configKeys) {
    results[k] = { pooled: newAcc() };
    for (const y of YEARS) results[k][y] = newAcc();
  }

  const perYear = {}; // year -> { yearData, contexts: {round: ctx} }
  const lastWeekPicks = {}; // baseline / best -> {picks, scores}
  const roundLog = {}; // year -> [{ R, baseline: pts, configs: { key: pts } }] — for --robust checks

  for (const year of YEARS) {
    console.log(`Loading ${year}...`);
    const yearData = await loadYear(db, year);
    const contexts = {};
    perYear[year] = { yearData, contexts };
    roundLog[year] = [];

    for (let R = MIN_ROUND; R <= yearData.maxRound; R++) {
      if (!yearData.rowsByRound.has(R)) continue;
      const ctx = buildRoundContext(yearData, R);
      if (ctx.eligiblePlayers.length < MAIN_POSITIONS.length) continue; // not enough data yet
      contexts[R] = ctx;

      // baseline
      accMAE(results.baseline[year], ctx, ctx.baselineByPlayer);
      accMAE(results.baseline.pooled, ctx, ctx.baselineByPlayer);
      const basePicks = pickTop1PerPosition(ctx, ctx.baselineByPlayer);
      const basePts = pickQualityTotal(ctx, basePicks);
      results.baseline[year].sumPick += basePts; results.baseline[year].rounds++;
      results.baseline.pooled.sumPick += basePts; results.baseline.pooled.rounds++;
      const configPts = {}; // key -> pts, this round — feeds roundLog for --robust checks

      for (const window of WINDOWS) {
        const wRows = windowRowsFor(yearData, window, R);
        for (const shrink of SHRINKS) {
          const mult = buildOpponentMultipliers(wRows, {
            positions: MAIN_POSITIONS, scoreGame, oppOf: r => r._opp, shrink, minGames: OPP_MIN_GAMES,
          });
          const scores = weightedScores(ctx, mult);
          const key = configKey(window, shrink);
          accMAE(results[key][year], ctx, scores);
          accMAE(results[key].pooled, ctx, scores);
          const picks = pickTop1PerPosition(ctx, scores);
          const pts = pickQualityTotal(ctx, picks);
          results[key][year].sumPick += pts; results[key][year].rounds++;
          results[key].pooled.sumPick += pts; results[key].pooled.rounds++;
          configPts[key] = pts;

          if (year === LAST_WEEK.year && R === LAST_WEEK.round) {
            lastWeekPicks[key] = { picks, scores, mult };
          }
        }
      }
      roundLog[year].push({ R, baseline: basePts, configs: configPts });
    }
  }
  console.log(`Grid pass done at ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Pick best grid config by pooled pick-quality delta over baseline.
  const baselinePooledPick = meanPick(results.baseline.pooled);
  let bestKey = null, bestDelta = -Infinity;
  for (const key of configKeys) {
    if (key === "baseline") continue;
    const delta = meanPick(results[key].pooled) - baselinePooledPick;
    if (delta > bestDelta) { bestDelta = delta; bestKey = key; }
  }
  console.log(`Best pooled config: ${bestKey} (pick-quality delta ${bestDelta.toFixed(2)} pts/round)`);

  // (c) optimizer-quality pass: baseline + best config only, all rounds.
  for (const year of YEARS) {
    const { yearData, contexts } = perYear[year];
    for (const [Rstr, ctx] of Object.entries(contexts)) {
      const R = Number(Rstr);
      const baseOpt = optimizerQualityTotal(ctx, ctx.baselineByPlayer);
      results.baseline[year].sumOpt += baseOpt; results.baseline[year].optRounds++;
      results.baseline.pooled.sumOpt += baseOpt; results.baseline.pooled.optRounds++;

      const [window, shrinkStr] = bestKey.split("|");
      const shrink = Number(shrinkStr);
      const w = window === "all" ? "all" : Number(window);
      const wRows = windowRowsFor(yearData, w, R);
      const mult = buildOpponentMultipliers(wRows, {
        positions: MAIN_POSITIONS, scoreGame, oppOf: r => r._opp, shrink, minGames: OPP_MIN_GAMES,
      });
      const scores = weightedScores(ctx, mult);
      const bestOpt = optimizerQualityTotal(ctx, scores);
      results[bestKey][year].sumOpt += bestOpt; results[bestKey][year].optRounds++;
      results[bestKey].pooled.sumOpt += bestOpt; results[bestKey].pooled.optRounds++;

      if (year === LAST_WEEK.year && R === LAST_WEEK.round) {
        lastWeekPicks.baselineOpt = baseOpt;
        lastWeekPicks.bestOpt = bestOpt;
      }
    }
  }
  console.log(`Optimizer pass done at ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ── Print tables ─────────────────────────────────────────────────────
  function printTable(label, yearOrPooled) {
    console.log(`\n=== ${label} ===`);
    console.log("config".padEnd(14) + "MAE".padStart(8) + "pick/rnd".padStart(12) + "delta".padStart(10) + "opt/rnd".padStart(10));
    const baseAcc = results.baseline[yearOrPooled];
    const baseMAE = mae(baseAcc), basePick = meanPick(baseAcc), baseOpt = meanOpt(baseAcc);
    console.log("baseline".padEnd(14) + baseMAE.toFixed(2).padStart(8) + basePick.toFixed(2).padStart(12)
      + "-".padStart(10) + (baseOpt != null ? baseOpt.toFixed(2) : "-").padStart(10));
    const rows = configKeys.filter(k => k !== "baseline").map(key => {
      const acc = results[key][yearOrPooled];
      return { key, m: mae(acc), p: meanPick(acc), o: meanOpt(acc), d: meanPick(acc) - basePick };
    }).sort((a, b) => b.d - a.d);
    for (const r of rows) {
      const flag = r.key === bestKey ? "  <= best pooled" : "";
      console.log(r.key.padEnd(14) + r.m.toFixed(2).padStart(8) + r.p.toFixed(2).padStart(12)
        + (r.d >= 0 ? "+" : "") + r.d.toFixed(2).padStart(9) + (r.o != null ? r.o.toFixed(2) : "-").padStart(10) + flag);
    }
  }

  for (const year of YEARS) printTable(`Year ${year}`, year);
  printTable("Pooled (all years)", "pooled");

  // ── Last week block: 2026 round 26 ──────────────────────────────────
  console.log(`\n=== LAST WEEK: ${LAST_WEEK.year} Round ${LAST_WEEK.round} — baseline vs best (${bestKey}) ===`);
  const lwCtx = perYear[LAST_WEEK.year].contexts[LAST_WEEK.round];
  if (!lwCtx) {
    console.log("(no data for this round)");
  } else {
    const basePicks = pickTop1PerPosition(lwCtx, lwCtx.baselineByPlayer);
    const best = lastWeekPicks[bestKey];
    console.log("pos".padEnd(14) + "player".padEnd(24) + "baseline".padStart(10) + "weighted".padStart(10) + "actual".padStart(10));
    for (const pos of MAIN_POSITIONS) {
      const baseName = basePicks[pos];
      const weightName = best ? best.picks[pos] : null;
      const baseProj = baseName ? lwCtx.baselineByPlayer[baseName][pos] : null;
      const weightProj = weightName ? best.scores[weightName][pos] : null;
      const showName = weightName || baseName || "-";
      const actual = showName !== "-" ? scoreGame(lwCtx.actualByPlayer[showName], pos) : null;
      console.log(pos.padEnd(14) + showName.padEnd(24)
        + (baseProj != null ? baseProj.toFixed(1) : "-").padStart(10)
        + (weightProj != null ? weightProj.toFixed(1) : "-").padStart(10)
        + (actual != null ? actual.toFixed(1) : "-").padStart(10));
    }
    const baseTotal = pickQualityTotal(lwCtx, basePicks);
    const weightTotal = best ? pickQualityTotal(lwCtx, best.picks) : null;
    console.log(`Totals: baseline=${baseTotal.toFixed(1)}  weighted=${weightTotal != null ? weightTotal.toFixed(1) : "-"}`);
    if (lastWeekPicks.baselineOpt != null) {
      console.log(`Optimizer (findOptimalLineup, top-12/pos pool): baseline=${lastWeekPicks.baselineOpt.toFixed(1)}  weighted=${lastWeekPicks.bestOpt.toFixed(1)}`);
    }
  }

  // ── Verdict ──────────────────────────────────────────────────────────
  const perYearDelta = YEARS.map(y => ({ y, d: meanPick(results[bestKey][y]) - meanPick(results.baseline[y]) }));
  const maeDelta = mae(results[bestKey].pooled) - mae(results.baseline.pooled);
  const holdsEvery = perYearDelta.every(x => x.d > 0);
  const holdsSome = perYearDelta.some(x => x.d > 0);
  console.log("\n=== VERDICT ===");
  console.log(`1. Weighting ${bestDelta > 0 ? "helps" : "does not help"}: pooled pick-quality delta ${bestDelta >= 0 ? "+" : ""}${bestDelta.toFixed(2)} pts/round, MAE delta ${maeDelta >= 0 ? "+" : ""}${maeDelta.toFixed(2)} (best=${bestKey}).`);
  const [bw, bs] = bestKey.split("|");
  console.log(`2. Best pooled config: window=${bw}, shrink=${bs}.`);
  console.log(`3. Holds in ${holdsEvery ? "every year" : holdsSome ? "only some years" : "no year"}: ${perYearDelta.map(x => `${x.y}=${x.d >= 0 ? "+" : ""}${x.d.toFixed(2)}`).join(", ")}.`);

  // ── --robust: four robustness checks on the fixed config (window=4/shrink=0.5) ──
  if (ROBUST) {
    console.log(`\n\n########## ROBUSTNESS CHECKS (config=${FIXED_KEY}) ##########`);

    // Flat list of {year, R, delta} for the fixed config, reused by checks 1 and 4.
    const flat = [];
    for (const year of YEARS) {
      for (const rec of roundLog[year]) {
        flat.push({ year, R: rec.R, delta: rec.configs[FIXED_KEY] - rec.baseline });
      }
    }

    // 1. Paired significance ------------------------------------------------
    console.log(`\n=== 1. Paired significance: ${FIXED_KEY} vs baseline, per-round deltas ===`);
    {
      const deltas = flat.map(x => x.delta);
      const n = deltas.length;
      const mean = deltas.reduce((a, b) => a + b, 0) / n;
      const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
      const nPos = deltas.filter(d => d > 0).length;
      const nNeg = deltas.filter(d => d < 0).length;
      const nTies = n - nPos - nNeg;
      const p = signTestP(nPos, nPos + nNeg);
      const rng = mulberry32(20260910);
      const { lo, hi } = bootstrapMeanCI(deltas, rng, 2000);
      console.log(`n=${n}  mean=${mean.toFixed(3)}  sd=${sd.toFixed(3)}  share>0=${((nPos / n) * 100).toFixed(1)}% (${nPos}/${n}, ${nTies} ties)`);
      console.log(`sign-test p (two-sided, binomial, ties excluded) = ${p.toExponential(3)}`);
      console.log(`95% bootstrap CI of mean (2000 resamples, seed=20260910): [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
    }

    // 2. Leave-one-year-out --------------------------------------------------
    console.log(`\n=== 2. Leave-one-year-out (best config chosen on other 2 years, full 16-config grid) ===`);
    {
      const allKeys = configKeys.filter(k => k !== "baseline");
      function pooledDelta(key, years) {
        let sum = 0, n = 0;
        for (const y of years) for (const rec of roundLog[y]) { sum += rec.configs[key] - rec.baseline; n++; }
        return n ? sum / n : null;
      }
      console.log("held-out".padEnd(10) + "chosen".padEnd(12) + "delta on held-out".padStart(20));
      const heldOutDeltas = [];
      for (const heldOut of YEARS) {
        const otherYears = YEARS.filter(y => y !== heldOut);
        let bestK = null, bestD = -Infinity;
        for (const key of allKeys) {
          const d = pooledDelta(key, otherYears);
          if (d > bestD) { bestD = d; bestK = key; }
        }
        const heldOutD = pooledDelta(bestK, [heldOut]);
        heldOutDeltas.push(heldOutD);
        const numStr = (heldOutD >= 0 ? "+" : "") + heldOutD.toFixed(2);
        console.log(String(heldOut).padEnd(10) + bestK.padEnd(12) + numStr.padStart(19));
      }
      const meanHeldOut = heldOutDeltas.reduce((a, b) => a + b, 0) / heldOutDeltas.length;
      console.log(`Mean of the 3 held-out deltas: ${meanHeldOut >= 0 ? "+" : ""}${meanHeldOut.toFixed(3)}`);
    }

    // 3. Placebo (shuffled opponent labels) -----------------------------------
    const PLACEBO_TRIALS = 20;
    console.log(`\n=== 3. Placebo: ${PLACEBO_TRIALS} trials, opp labels shuffled within each year (history rows only) ===`);
    {
      const realDelta = meanPick(results[FIXED_KEY].pooled) - meanPick(results.baseline.pooled);
      const baselineByR = {};
      for (const year of YEARS) baselineByR[year] = new Map(roundLog[year].map(r => [r.R, r.baseline]));

      function placeboTrialDelta(trialSeed) {
        const rng = mulberry32(trialSeed);
        let sum = 0, n = 0;
        for (const year of YEARS) {
          const { yearData, contexts } = perYear[year];
          const allRows = [...yearData.rowsByRound.values()].flat();
          const shuffledOpps = allRows.map(r => r._opp);
          shuffleInPlace(shuffledOpps, rng);
          const permMap = new Map();
          allRows.forEach((r, i) => permMap.set(r, shuffledOpps[i]));

          for (const [Rstr, ctx] of Object.entries(contexts)) {
            const R = Number(Rstr);
            const wRows = windowRowsFor(yearData, 4, R);
            const mult = buildOpponentMultipliers(wRows, {
              positions: MAIN_POSITIONS, scoreGame, shrink: 0.5, minGames: OPP_MIN_GAMES,
              oppOf: r => permMap.get(r),
            });
            const scores = weightedScores(ctx, mult);
            const picks = pickTop1PerPosition(ctx, scores);
            const pts = pickQualityTotal(ctx, picks);
            sum += pts - baselineByR[year].get(R);
            n++;
          }
        }
        return n ? sum / n : null;
      }

      const placeboDeltas = [];
      for (let trial = 0; trial < PLACEBO_TRIALS; trial++) placeboDeltas.push(placeboTrialDelta(900000 + trial));
      placeboDeltas.sort((a, b) => a - b);
      const pMean = placeboDeltas.reduce((a, b) => a + b, 0) / placeboDeltas.length;
      const pLo = placeboDeltas[Math.max(0, Math.floor(0.025 * placeboDeltas.length))];
      const pHi = placeboDeltas[Math.min(placeboDeltas.length - 1, Math.floor(0.975 * placeboDeltas.length))];
      const shareGe = placeboDeltas.filter(d => d >= realDelta).length / placeboDeltas.length;
      console.log(`Placebo deltas: mean=${pMean.toFixed(3)}  95% range=[${pLo.toFixed(3)}, ${pHi.toFixed(3)}]`);
      console.log(`Real delta = ${realDelta >= 0 ? "+" : ""}${realDelta.toFixed(2)}  |  share of placebo trials >= real = ${(shareGe * 100).toFixed(1)}% (${placeboDeltas.filter(d => d >= realDelta).length}/${placeboDeltas.length})`);
    }

    // 4. Finals rounds only ---------------------------------------------------
    function restrictedTable(label, filterFn) {
      console.log(`\n=== 4. ${label}: ${FIXED_KEY} vs baseline ===`);
      const allDeltas = [];
      for (const year of YEARS) {
        const recs = roundLog[year].filter(r => filterFn(r.R));
        if (recs.length === 0) continue;
        const baseMean = recs.reduce((a, r) => a + r.baseline, 0) / recs.length;
        const weightedMean = recs.reduce((a, r) => a + r.configs[FIXED_KEY], 0) / recs.length;
        const delta = weightedMean - baseMean;
        const perRoundDeltas = recs.map(r => +(r.configs[FIXED_KEY] - r.baseline).toFixed(2));
        allDeltas.push(...perRoundDeltas);
        console.log(`${year}  rounds=[${recs.map(r => r.R).join(",")}]  baseline=${baseMean.toFixed(2)}  weighted=${weightedMean.toFixed(2)}  delta=${delta >= 0 ? "+" : ""}${delta.toFixed(2)}  per-round=[${perRoundDeltas.map(d => (d >= 0 ? "+" : "") + d).join(",")}]`);
      }
      if (allDeltas.length) {
        const pooledMean = allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length;
        console.log(`Pooled (n=${allDeltas.length}): mean delta = ${pooledMean >= 0 ? "+" : ""}${pooledMean.toFixed(3)}`);
      } else {
        console.log("(no rounds matched)");
      }
    }
    restrictedTable("Finals rounds only (round > 24)", R => R > 24);
    restrictedTable("Late-season sample (round >= 20)", R => R >= 20);
  }

  console.log(`\nTotal runtime: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await client.close();
}

main().catch(err => { console.error("Fatal error:", err); process.exit(1); });

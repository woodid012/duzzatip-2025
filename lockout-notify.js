#!/usr/bin/env node
/**
 * DuzzaTip 2026 — Lockout Notification & Weekly Assistant 🦆⚡
 *
 * Dual-mode: headless automation (Telegram alerts) OR interactive CLI.
 *
 * Usage:
 *   node lockout-notify.js                    — headless: auto-detect round, save + Telegram if lockout ≤36h
 *   node lockout-notify.js --interactive      — interactive CLI with swap/tip editing
 *   node lockout-notify.js --round=5          — force round 5
 *   node lockout-notify.js --force            — skip the 36h lockout gate (always send)
 *   node lockout-notify.js --dry-run          — compute everything, don't save or send
 *   node lockout-notify.js --team             — team selection only (skip tips)
 *   node lockout-notify.js --tips             — tipping only (skip team)
 *
 * Setup: add to .env.local →  TELEGRAM_BOT_TOKEN=<your token from BotFather>
 */

require("dotenv").config({ path: ".env.local" });

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const fs       = require("fs");
const pathMod  = require("path");
const https    = require("https");
const readline = require("readline");
const { MongoClient } = require("mongodb");

// Injuries loaded from MongoDB at startup, with static file fallback
let INJURIES = {};
const INJURY_DISPLAY = {
  SEASON: { label: "OUT SEASON", color: "\x1b[31m" },
  MONTHS: { label: "OUT MONTHS", color: "\x1b[33m" },
  WEEKS:  { label: "OUT WEEKS",  color: "\x1b[33m" },
  DOUBT:  { label: "DOUBT",      color: "\x1b[35m" },
  MANAGED:{ label: "MANAGED",    color: "\x1b[36m" },
};

// ===== Config =====
const MY_USER  = 4;
const YEAR     = 2026;
const NOTIFY_WINDOW_HOURS = 24;
const TELEGRAM_CHAT_ID = "8600335192";
const STATE_FILE = pathMod.join(__dirname, ".notified-rounds.json");

// MongoDB connection — prefer env var; fall back to the shared league cluster.
const MONGODB_URI = process.env.MONGODB_URI ||
  "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

// Short team names for trade reporting (keyed by user_id)
const USER_SHORT = {
  1: "Feathers", 2: "Sharky", 3: "Miguel", 4: "Quack",
  5: "Randy", 6: "Milky Briz", 7: "String Theory", 8: "Pinga",
};

// ===== Scoring formulas =====
const SCORE_FNS = {
  "Full Forward": (s) => s.goals * 9 + s.behinds,
  "Midfielder":   (s) => { const d = s.kicks + s.handballs; return Math.min(d, 30) + Math.max(0, d - 30) * 3; },
  "Offensive":    (s) => s.goals * 7 + s.kicks,
  "Tall Forward": (s) => s.goals * 6 + s.marks * 2,
  "Tackler":      (s) => s.tackles * 4 + s.handballs,
  "Ruck":         (s) => {
    const t = s.hitouts + s.marks;
    if (t <= 18) return t;
    const reg = Math.max(0, 18 - s.hitouts);
    return s.hitouts + reg + (s.marks - reg) * 3;
  },
};

const MAIN_POSITIONS   = ["Full Forward", "Tall Forward", "Offensive", "Midfielder", "Tackler", "Ruck"];
const POS_SHORT        = { "Full Forward": "FF", "Tall Forward": "TF", "Offensive": "OFF", "Midfielder": "MID", "Tackler": "TAK", "Ruck": "RUC" };
const RESERVE_A_COVERS = ["Full Forward", "Tall Forward", "Ruck"];
const RESERVE_B_COVERS = ["Offensive", "Midfielder", "Tackler"];

// ===== Display helpers (colors used in interactive mode) =====
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", magenta: "\x1b[35m", bgGreen: "\x1b[42;30m", bgYellow: "\x1b[43;30m",
};

function header(text) {
  console.log(`\n${C.bold}${C.cyan}${"═".repeat(64)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${"═".repeat(64)}${C.reset}`);
}
function section(text) { console.log(`\n${C.bold}${C.yellow}── ${text} ${"─".repeat(Math.max(0, 48 - text.length))}${C.reset}`); }

function dn(name) {
  if (!name) return name;
  const parts = name.trim().split(" ");
  if (parts.length < 2) return name;
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
}

function injBadge(name) {
  const inj = INJURIES[name];
  if (!inj) return "";
  const d = INJURY_DISPLAY[inj.status];
  return ` ${d.color}[${d.label}: ${inj.detail}]${C.reset}`;
}

function injSeverity(name) {
  const inj = INJURIES[name];
  if (!inj) return 0;
  return { SEASON: 4, MONTHS: 3, WEEKS: 2, DOUBT: 1, MANAGED: 0 }[inj.status] ?? 0;
}

function injNote(name) {
  const inj = INJURIES[name];
  if (!inj) return "";
  const labels = { SEASON: "OUT SEASON", MONTHS: "OUT MONTHS", WEEKS: "OUT WEEKS", DOUBT: "DOUBT", MANAGED: "managed" };
  return ` [${labels[inj.status] || inj.status}: ${inj.detail}]`;
}

// ===== State (already-notified rounds) =====
// Tracks two sends per round: "early" (when teams come out, ~day before)
// and "final" (1hr before lockout, after late team changes)
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    // Migrate old format: { notified: [4] } → { rounds: { "4": { early: true } } }
    if (raw.notified && !raw.rounds) {
      const rounds = {};
      for (const r of raw.notified) rounds[r] = { early: true, final: true };
      return { rounds };
    }
    return raw.rounds ? raw : { rounds: {} };
  }
  catch (_) { return { rounds: {} }; }
}
function saveState(state) {
  // Keep only last 5 rounds
  const keys = Object.keys(state.rounds).map(Number).sort((a, b) => a - b);
  if (keys.length > 5) {
    for (const k of keys.slice(0, keys.length - 5)) delete state.rounds[k];
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
// Threshold: sends within this many minutes of lockout count as "final"
const FINAL_WINDOW_MINS = 45;

// ===== Fixtures =====
function loadFixtures() {
  const p = `./public/afl-${YEAR}.json`;
  if (!fs.existsSync(p)) throw new Error(`Fixture file not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function getCurrentRound(fixtures) {
  const now = new Date();
  const upcoming = fixtures.filter(f => f.RoundNumber > 0 && new Date(f.DateUtc) > now);
  if (!upcoming.length) return Math.max(...fixtures.map(f => f.RoundNumber));
  return upcoming[0].RoundNumber;
}
function getLockoutInfo(fixtures, round) {
  const rf = fixtures.filter(f => f.RoundNumber === round).sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));
  if (!rf.length) return null;
  const firstGame = new Date(rf[0].DateUtc);
  const now = new Date();
  const minsUntil = Math.round((firstGame - now) / 60000);
  const hoursUntil = minsUntil / 60;
  const melbTime = firstGame.toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true
  });
  return { firstGame, locked: now >= firstGame, minsUntil, hoursUntil, melbTime, placeholder: looksLikePlaceholder(rf) };
}

// Safety net: a round whose times never got refreshed from the AFL API (e.g. API
// was down AND the seeded JSON was stale) shows the tell-tale placeholder shape —
// several games pinned to the exact same kickoff instant. We must never silently
// trust such a lockout for the "too far away, skip" gate, since that's exactly the
// failure that swallowed a weekly alert. Returns true when ≥3 games in the round
// share one DateUtc.
function looksLikePlaceholder(roundFixtures) {
  if (!roundFixtures || roundFixtures.length < 3) return false;
  const counts = {};
  for (const f of roundFixtures) counts[f.DateUtc] = (counts[f.DateUtc] || 0) + 1;
  return Object.values(counts).some(n => n >= 3);
}
function getRoundFixtures(fixtures, round) {
  return fixtures.filter(f => f.RoundNumber === round).sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));
}

// Returns a Set of team names playing in this round (for bye detection)
function getPlayingTeams(roundFixtures) {
  const teams = new Set();
  for (const f of roundFixtures) { teams.add(f.HomeTeam); teams.add(f.AwayTeam); }
  return teams;
}
function teamIsPlaying(dbTeam, playingTeams) {
  if (!dbTeam) return true;
  // Substring matching collides on shared fragments (e.g. "Gold Coast SUNS"
  // was matching "St Kilda" because "coast" contains "st"). Slug both sides
  // and compare canonically.
  const dbSlug = findTeamSlug(dbTeam);
  if (dbSlug) {
    for (const t of playingTeams) {
      if (findTeamSlug(t) === dbSlug) return true;
    }
    return false;
  }
  const dbT = dbTeam.toLowerCase().trim();
  for (const t of playingTeams) {
    if (t.toLowerCase().trim() === dbT) return true;
  }
  return false;
}

// ===== Player stats =====
function calcAvgStats(games) {
  if (!games || !games.length) return null;
  const keys = ["kicks", "handballs", "marks", "tackles", "hitouts", "goals", "behinds"];
  const avg = {};
  for (const k of keys) avg[k] = games.reduce((a, g) => a + (Number(g[k]) || 0), 0) / games.length;
  return avg;
}
function scoreAllPositions(avg) {
  if (!avg) return {};
  const out = {};
  for (const [pos, fn] of Object.entries(SCORE_FNS)) out[pos] = Math.round(fn(avg) * 10) / 10;
  return out;
}
// Project per-position scores by averaging each game's score, NOT by scoring the
// average stat line. The Midfielder and Ruck formulas are convex (disposals >30
// and bonus marks pay 3×), so scoring the mean understates high-ceiling players
// at those positions (Jensen's inequality). The linear positions (FF/TF/OFF/TAK)
// are unaffected — mean-of-scores equals score-of-mean there. Uses the same
// per-game scoreGame() the bench option-value model relies on.
function scorePositionsFromGames(games) {
  if (!games || !games.length) return {};
  const out = {};
  for (const pos of Object.keys(SCORE_FNS)) {
    const sum = games.reduce((a, g) => a + scoreGame(g, pos), 0);
    out[pos] = Math.round((sum / games.length) * 10) / 10;
  }
  return out;
}
async function loadPlayerStats(db, names) {
  const stats = {};
  try {
    const docs = await db.collection(`${YEAR}_game_results`).find({
      player_name: { $in: names },
      round: { $gte: 1 },  // exclude preseason (round 0)
    }).toArray();
    const byPlayer = {};
    for (const d of docs) {
      // Skip sub-affected appearances: a low time-on-ground game (early sub-out,
      // ~20-30% TOG) posts depressed stats that drag the season average and can
      // cost a player a starting spot. Mirrors the CSV path's tog<50 guard. Guard
      // on tog>0 so rows that simply lack the field aren't all discarded.
      const tog = Number(d.timeOnGroundPercentage);
      if (Number.isFinite(tog) && tog > 0 && tog < 50) continue;
      if (!byPlayer[d.player_name]) byPlayer[d.player_name] = [];
      if (byPlayer[d.player_name].some(g => g.round === d.round)) continue; // deduplicate
      byPlayer[d.player_name].push(d);
    }
    for (const [name, games] of Object.entries(byPlayer)) {
      // Keep the per-game array (not just the count) so the bench option-value
      // model can compute E[max(bench−starter,0)] over real game distributions.
      if (games.length >= 2) stats[name] = { source: `2026(${games.length}g)`, games, avg: calcAvgStats(games) };
    }
  } catch (_) {}

  const needCsv = names.filter(n => !stats[n] || stats[n].games.length < 5);
  if (needCsv.length > 0 && fs.existsSync("./afl-stats-1771399552485.csv")) {
    const Papa = require("papaparse");
    const raw = fs.readFileSync("./afl-stats-1771399552485.csv", "utf8");
    const parsed = Papa.parse(raw.split("\n").slice(3).join("\n"), { header: true, skipEmptyLines: true });
    const byPlayer = {};
    for (const row of parsed.data) {
      const name = row.player?.trim();
      if (!name || !needCsv.includes(name)) continue;
      const tog = parseFloat(row.tog) || 0;
      if (parseInt(row.round) < 1 || tog < 50) continue;
      if (!byPlayer[name]) byPlayer[name] = [];
      byPlayer[name].push({
        kicks: +row.kicks||0, handballs: +row.handballs||0, marks: +row.marks||0,
        tackles: +row.tackles||0, hitouts: +row.hitouts||0, goals: +row.goals||0, behinds: +row.behinds||0,
      });
    }
    for (const [name, games] of Object.entries(byPlayer)) {
      if (games.length >= 3) stats[name] = { source: `2025CSV(${games.length}g)`, games, avg: calcAvgStats(games) };
    }
  }
  return stats;
}

// ===== Trade performance analysis =====
// Each traded player's contribution is measured by their best-position DuzzaTip
// score for that single game (the position they'd be most valuable in), summed
// over every round from the trade's first effective round to the latest
// completed round. Games missed (bye/injury/omission) are tracked too — a
// player who isn't on the park scores nothing, which is part of the trade cost.

function bestGameScore(stats) {
  let best = 0;
  for (const fn of Object.values(SCORE_FNS)) {
    const v = fn(stats);
    if (v > best) best = v;
  }
  return best;
}

// Latest round whose final fixture has already started (i.e. fully under way /
// complete). In-progress rounds are excluded so comparisons use whole rounds.
function getLastCompletedRound(fixtures) {
  const now = new Date();
  const rounds = [...new Set(fixtures.filter(f => f.RoundNumber > 0).map(f => f.RoundNumber))].sort((a, b) => a - b);
  let last = 0;
  for (const r of rounds) {
    const rf = fixtures.filter(f => f.RoundNumber === r);
    const lastGame = Math.max(...rf.map(f => new Date(f.DateUtc).getTime()));
    if (lastGame < now.getTime()) last = r; else break;
  }
  return last;
}

// First round a trade takes effect: the earliest round whose opening fixture
// starts strictly after the trade was made.
function getEffectiveRound(fixtures, tradeDate) {
  const t = new Date(tradeDate).getTime();
  const rounds = [...new Set(fixtures.filter(f => f.RoundNumber > 0).map(f => f.RoundNumber))].sort((a, b) => a - b);
  for (const r of rounds) {
    const firstGame = Math.min(...fixtures.filter(f => f.RoundNumber === r).map(f => new Date(f.DateUtc).getTime()));
    if (firstGame > t) return r;
  }
  return rounds[rounds.length - 1] + 1;
}

// Load trade transactions and collapse the two mirrored per-user records (and
// multiple same-day swaps between the same pair) into one event each.
async function loadTradeEvents(db, fixtures) {
  const docs = await db.collection(`${YEAR}_squad_transactions`)
    .find({ type: "trade", Active: 1 })
    .sort({ transaction_date: 1 })
    .toArray();

  const events = new Map(); // key: "low-high|day"
  for (const d of docs) {
    const partner = d.trade_with_user_id;
    if (partner == null) continue;
    const a = parseInt(d.user_id), b = parseInt(partner);
    const low = Math.min(a, b), high = Math.max(a, b);
    const day = new Date(d.transaction_date).toISOString().slice(0, 10);
    const key = `${low}-${high}|${day}`;

    if (!events.has(key)) {
      events.set(key, {
        day, userLow: low, userHigh: high,
        lowReceives: new Set(), highReceives: new Set(),
        earliest: new Date(d.transaction_date),
      });
    }
    const ev = events.get(key);
    const dt = new Date(d.transaction_date);
    if (dt < ev.earliest) ev.earliest = dt;

    // players_in are received by d.user_id; players_out go to the partner.
    const inNames = (d.players_in || []).map(p => typeof p === "string" ? p : p.name);
    const outNames = (d.players_out || []).map(p => typeof p === "string" ? p : p.name);
    if (a === low) { inNames.forEach(n => ev.lowReceives.add(n)); outNames.forEach(n => ev.highReceives.add(n)); }
    else           { inNames.forEach(n => ev.highReceives.add(n)); outNames.forEach(n => ev.lowReceives.add(n)); }
  }

  return [...events.values()]
    .map(ev => ({
      ...ev,
      lowReceives: [...ev.lowReceives],
      highReceives: [...ev.highReceives],
      roundEff: getEffectiveRound(fixtures, ev.earliest),
    }))
    .sort((a, b) => a.earliest - b.earliest);
}

// Score every involved player's best-position output per round, then tally each
// side of every trade across its window.
async function evaluateTradeEvents(db, fixtures, events, lastRound) {
  const names = [...new Set(events.flatMap(e => [...e.lowReceives, ...e.highReceives]))];
  const docs = await db.collection(`${YEAR}_game_results`).find({
    player_name: { $in: names },
    round: { $gte: 1, $lte: lastRound },
  }).toArray();

  // player -> round -> best score (dedupe duplicate rows per round)
  const byPlayer = {};
  for (const d of docs) {
    const m = (byPlayer[d.player_name] ||= {});
    if (m[d.round] == null) m[d.round] = bestGameScore(d);
  }

  const tally = (name, start) => {
    let pts = 0, played = 0;
    const rounds = byPlayer[name] || {};
    for (let r = start; r <= lastRound; r++) {
      if (rounds[r] != null) { pts += rounds[r]; played++; }
    }
    const window = Math.max(0, lastRound - start + 1);
    return { name, pts: Math.round(pts), played, missed: window - played,
             avg: played ? Math.round(pts / played * 10) / 10 : 0 };
  };

  return events.map(ev => {
    const window = Math.max(0, lastRound - ev.roundEff + 1);
    const low = ev.lowReceives.map(n => tally(n, ev.roundEff));
    const high = ev.highReceives.map(n => tally(n, ev.roundEff));
    const lowPts = low.reduce((s, p) => s + p.pts, 0);
    const highPts = high.reduce((s, p) => s + p.pts, 0);
    const diff = lowPts - highPts;
    const winner = Math.abs(diff) < 1 ? null : (diff > 0 ? ev.userLow : ev.userHigh);
    return { ev, window, low, high, lowPts, highPts, diff, winner };
  });
}

function buildTradeMessage(reports, lastRound) {
  const lines = [];
  lines.push(`\u{1F501} *DuzzaTip Trade Report* — through Rd${lastRound}`);
  lines.push(`_Best-position pts since each trade. (g=played, m=missed)_`);
  lines.push("");

  if (!reports.length) { lines.push("_No trades recorded this season._"); return lines.join("\n"); }

  const fmtDay = (day) => new Date(day + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  const sideLines = (label, name, players, pts) => {
    const out = [`  *${label} ${name}* got ⇒ *${pts}* pts`];
    if (!players.length) out.push(`     • —`);
    for (const p of players) out.push(`     • ${p.name} — *${p.pts}* _(${p.played}g, ${p.missed}m)_`);
    return out;
  };

  for (const rep of reports) {
    const { ev } = rep;
    const lowN = USER_SHORT[ev.userLow] || `U${ev.userLow}`;
    const highN = USER_SHORT[ev.userHigh] || `U${ev.userHigh}`;
    lines.push(`\u{1F4C5} *${fmtDay(ev.day)}*  ${lowN} ⇄ ${highN}  _(R${ev.roundEff}–${lastRound})_`);
    lines.push(...sideLines("⬅", lowN, rep.low, rep.lowPts));
    lines.push(...sideLines("➡", highN, rep.high, rep.highPts));
    if (rep.winner == null) {
      lines.push(`  ⚖️ *Dead even*`);
    } else {
      const wn = USER_SHORT[rep.winner] || `U${rep.winner}`;
      lines.push(`  \u{1F3C6} *${wn} winning by ${Math.abs(rep.diff)}*`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ===== Optimal lineup =====
// Exact max-weight assignment of players to positions (keeps the CLI in sync
// with the /api/lockout-notify route). Replaces the old greedy "margin" pick,
// which was a heuristic and could leave points on the table. With only 6
// positions, a classic assignment DP over a bitmask of filled positions is cheap.
function popcount(n) { let c = 0; while (n) { n &= n - 1; c++; } return c; }
function optimalAssignment(pool, positions) {
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
        const nscore = state.score + (player.scores[positions[i]] || 0);
        const cur = next.get(nmask);
        if (!cur || nscore > cur.score) {
          next.set(nmask, { score: nscore, assign: { ...state.assign, [positions[i]]: player } });
        }
      }
    }
    dp = next;
  }
  let best = dp.get(FULL);
  if (!best) {
    best = [...dp.entries()]
      .sort(([am, a], [bm, b]) => popcount(bm) - popcount(am) || b.score - a.score)[0]?.[1]
      || { score: 0, assign: {} };
  }
  return { assign: best.assign, used: new Set(Object.values(best.assign).map(p => p.name)) };
}

// ===== Bench option-value model =====
// The bench is ALWAYS active: at scoring time the engine awards max(starter,
// bench) for the one backed-up position (see src/app/lib/scoreCalculations.js),
// so the bench's real contribution is the marginal UPLIFT it provides — not its
// raw score. With per-game samples we measure the exact expected uplift,
// E[max(bench − starter, 0)], over every game-pair combination ("option value").
// Mirrors the model in src/app/api/lockout-notify/route.js to keep them in sync.
function scoreGame(game, pos) {
  const s = {
    kicks: +game.kicks || 0, handballs: +game.handballs || 0, marks: +game.marks || 0,
    tackles: +game.tackles || 0, hitouts: +game.hitouts || 0, goals: +game.goals || 0, behinds: +game.behinds || 0,
  };
  return SCORE_FNS[pos](s);
}
function expectedBenchGain(benchGames, mainGames, pos) {
  if (!benchGames?.length || !mainGames?.length) return 0;
  let total = 0, count = 0;
  for (const bg of benchGames) {
    const bs = scoreGame(bg, pos);
    for (const mg of mainGames) { total += Math.max(bs - scoreGame(mg, pos), 0); count++; }
  }
  return count > 0 ? Math.round((total / count) * 10) / 10 : 0;
}
const BENCH_MIN_GAMES = 3;
function benchGainFor(candidate, starter, pos, statsMap) {
  const cg = statsMap[candidate.name]?.games || [];
  const mg = statsMap[starter.name]?.games || [];
  if (cg.length >= BENCH_MIN_GAMES && mg.length >= BENCH_MIN_GAMES) {
    return expectedBenchGain(cg, mg, pos);
  }
  // Thin sample — fall back to the season-score edge over the starter.
  return Math.max((candidate.scores[pos] || 0) - (starter.scores[pos] || 0), 0);
}

function findOptimalLineup(squadPlayers, excluded = new Set(), statsMap = {}, selectionStatus = null) {
  const pool = squadPlayers.filter(p => !excluded.has(p.name) && p.scores && Object.keys(p.scores).length > 0);
  const { assign: assigned, used } = optimalAssignment(pool, MAIN_POSITIONS);

  // Bench: pick the (player, position) pair with the highest option value — the
  // expected uplift E[max(bench − starter, 0)] for the position it backs up, plus
  // an insurance term that rewards covering a starter at DNP risk (the bench also
  // covers a DNP of its backup position before round-end, unlike the reserves).
  const benchPool = pool.filter(p => !used.has(p.name));
  let bench = null, benchBackup = MAIN_POSITIONS[0], benchGain = 0;
  if (benchPool.length > 0) {
    let bestValue = -Infinity;
    for (const p of benchPool) {
      for (const pos of MAIN_POSITIONS) {
        const starter = assigned[pos];
        if (!starter) continue;
        const gain = benchGainFor(p, starter, pos, statsMap);
        const atRisk = injSeverity(starter.name) >= 1 || selectionStatus?.get(starter.name) === "emergency";
        // Insurance: when the starter is a doubt/emergency the bench may have to
        // cover a 0, so its full score is in play (weighted 0.5). A tiny baseline
        // (0.05) breaks zero-gain ties toward the bench's strongest backup slot.
        const insurance = (p.scores[pos] || 0) * (atRisk ? 0.5 : 0.05);
        const value = gain + insurance;
        if (value > bestValue) { bestValue = value; bench = p; benchBackup = pos; benchGain = gain; }
      }
    }
    if (bench) used.add(bench.name);
  }

  const resAScore = p => Math.max(...RESERVE_A_COVERS.map(pos => p.scores[pos] || 0));
  const resA = pool.filter(p => !used.has(p.name)).sort((a, b) => resAScore(b) - resAScore(a))[0] || null;
  if (resA) used.add(resA.name);

  const resBScore = p => Math.max(...RESERVE_B_COVERS.map(pos => p.scores[pos] || 0));
  const resB = pool.filter(p => !used.has(p.name)).sort((a, b) => resBScore(b) - resBScore(a))[0] || null;

  return { lineup: assigned, bench, benchBackup, benchExpectedGain: Math.round(benchGain * 10) / 10, reserveA: resA, reserveB: resB };
}

// ===== Print lineup (interactive mode) =====
function printLineup(result, excluded = new Set()) {
  let total = 0;
  const rows = [
    ...MAIN_POSITIONS.map(pos => ({ label: pos, player: result.lineup[pos], score: result.lineup[pos]?.scores[pos] })),
    { label: "Bench", player: result.bench, extra: `→ backs up ${result.benchBackup || "?"}` },
    { label: "Reserve A", player: result.reserveA, extra: `covers ${RESERVE_A_COVERS.map(p => POS_SHORT[p]).join("/")}` },
    { label: "Reserve B", player: result.reserveB, extra: `covers ${RESERVE_B_COVERS.map(p => POS_SHORT[p]).join("/")}` },
  ];
  for (const { label, player, score, extra } of rows) {
    if (!player) { console.log(`  ${C.red}${label.padEnd(14)} (no player available)${C.reset}`); continue; }
    const scoreStr = score != null ? ` ${C.bold}${score}${C.reset}pts` : "";
    const extraStr = extra ? ` ${C.dim}[${extra}]${C.reset}` : "";
    const inj = injBadge(player.name);
    const src = player.statsSource ? ` ${C.dim}${player.statsSource}${C.reset}` : "";
    const outFlag = excluded.has(player.name) ? ` ${C.red}[OUT]${C.reset}` : "";
    if (score) total += score;
    console.log(`  ${C.bold}${label.padEnd(14)}${C.reset} ${C.green}${dn(player.name).padEnd(28)}${C.reset}(${(player.team || "??").padEnd(4)})${src}${scoreStr}${extraStr}${inj}${outFlag}`);
  }
  console.log(`\n  ${C.bold}Projected score: ~${Math.round(total)} pts/round${C.reset}`);
}

// ===== AFL Team Selections =====
// Team aliases, slug helpers, AFL/Squiggle/Sportsbet fetchers and the
// tip-suggestion builder live in src/app/lib/lockoutShared.js so the CLI and
// the /api/lockout-notify route stay in sync (prior duplication caused real
// outages whenever AFL rotated to Indigenous-language team names).
const {
  TEAM_ALIASES,
  normName,
  findTeamSlug,
  fetchAFLTeamSelections,
  fetchSquiggleTips: fetchSquiggleTipsShared,
  fetchSportsbetOdds,
  buildTipSuggestions,
} = require("./src/app/lib/lockoutShared");

function playerNameMatches(dbName, names) {
  const norm = normName(dbName);
  if (names.some(n => normName(n) === norm)) return true;
  const parts = norm.split(" ");
  if (parts.length < 2) return false;
  const surname = parts[parts.length - 1];
  const initial = parts[0][0];
  return names.some(n => {
    const nParts = normName(n).split(" ");
    if (nParts.length < 2) return false;
    return nParts[nParts.length - 1] === surname && nParts[0][0] === initial;
  });
}
function buildSelectionStatus(squadPlayers, selections) {
  const status = new Map();
  for (const p of squadPlayers) {
    const slug = findTeamSlug(p.team);
    if (!slug || !selections[slug]) { status.set(p.name, "unknown"); continue; }
    const { named22, emergencies } = selections[slug];
    if (playerNameMatches(p.name, named22)) status.set(p.name, "playing");
    else if (playerNameMatches(p.name, emergencies)) status.set(p.name, "emergency");
    else status.set(p.name, "out");
  }
  return status;
}

// — Team selections from official AFL API —
async function fetchTeamSelections(roundNumber) {
  const { selections: aflSel, teamsFound, ppCount, error } = await fetchAFLTeamSelections(roundNumber);
  if (aflSel && teamsFound > 0) {
    return { selections: aflSel, source: `AFL API (${teamsFound} teams, ${ppCount} players)` };
  }
  return { selections: null, source: `unavailable${error ? `: ${error}` : ""}` };
}

// Thin wrappers so the rest of this script keeps its current call signatures.
async function fetchSquiggleTips(round) {
  const { tips } = await fetchSquiggleTipsShared(round, YEAR);
  return tips;
}

// ===== DB saves =====
async function saveTeamSelection(db, round, result) {
  const col = db.collection(`${YEAR}_team_selection`);
  const bulkOps = [{ updateMany: { filter: { Round: round, User: MY_USER }, update: { $set: { Active: 0 } } } }];
  const toSave = [
    ...MAIN_POSITIONS.map(pos => result.lineup[pos] ? { pos, name: result.lineup[pos].name } : null),
    result.bench       ? { pos: "Bench",     name: result.bench.name,     backup: result.benchBackup } : null,
    result.reserveA    ? { pos: "Reserve A", name: result.reserveA.name } : null,
    result.reserveB    ? { pos: "Reserve B", name: result.reserveB.name } : null,
  ].filter(Boolean);
  for (const { pos, name, backup } of toSave) {
    bulkOps.push({ updateOne: {
      filter: { Round: round, User: MY_USER, Position: pos },
      update: { $set: { Player_Name: name, Position: pos, Round: round, User: MY_USER,
        ...(pos === "Bench" && backup ? { Backup_Position: backup } : {}),
        Active: 1, Last_Updated: new Date() } },
      upsert: true,
    }});
  }
  await col.bulkWrite(bulkOps, { ordered: false });
}
async function saveTips(db, round, tips) {
  const col = db.collection(`${YEAR}_tips`);

  // The UI uses IsDefault===true to mean "this is just a fallback, not a real
  // submission" (renders as "(Def)" italic). So all cron-written tips MUST be
  // IsDefault:false to display as submitted. To still tell auto from manual,
  // cron writes set AutoPicked:true; manual UI saves leave it absent.
  const existing = await col.find({ User: MY_USER, Round: round, Active: 1 }).toArray();
  const manualMatches = new Set(
    existing.filter(d => d.AutoPicked !== true).map(d => d.MatchNumber)
  );

  const bulkOps = [
    // Deactivate prior auto-picks so a stale auto pick from a previous cron
    // run gets cleared (the new write below will reactivate the slot).
    { updateMany: { filter: { User: MY_USER, Round: round, AutoPicked: true }, update: { $set: { Active: 0 } } } },
    // Heal data written by the buggy v8 cron: any existing active tip with
    // IsDefault:true was a cron save mislabelled as a fallback. Flip it back
    // so the UI shows it as a real submission.
    { updateMany: { filter: { User: MY_USER, Round: round, Active: 1, IsDefault: true }, update: { $set: { IsDefault: false } } } },
  ];
  const written = [], preserved = [];
  for (const [matchNumStr, tip] of Object.entries(tips)) {
    const matchNum = parseInt(matchNumStr);
    if (manualMatches.has(matchNum)) { preserved.push(matchNum); continue; }
    written.push(matchNum);
    bulkOps.push({
      updateOne: {
        filter: { User: MY_USER, Round: round, MatchNumber: matchNum },
        update: { $set: { Team: tip.team, DeadCert: tip.deadCert || false, Active: 1, LastUpdated: new Date(), IsDefault: false, AutoPicked: true } },
        upsert: true,
      }
    });
  }

  await col.bulkWrite(bulkOps, { ordered: false });
  try { await db.collection(`${YEAR}_tipping_ladder_cache`).deleteMany({ year: YEAR, upToRound: { $gte: round } }); } catch (_) {}
  return { written, preserved };
}

// ===== Format Telegram message =====
function formatGameTime(dateUtc) {
  return new Date(dateUtc).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true
  });
}

function buildMessage({ round, lockout, result, autoExcluded, byePlayers, selectionStatus, tipSuggestions, otherAvailable, savedTeam, savedTips, dryRun, isFinal }) {
  const lines = [];
  const hrs  = Math.floor(Math.abs(lockout.minsUntil) / 60);
  const mins = Math.abs(lockout.minsUntil) % 60;
  const timeStr = lockout.locked ? `LOCKED (game has started)` : `${lockout.melbTime}  (${hrs}h ${mins}m away)`;
  const sendType = isFinal ? "FINAL Update" : "Early Preview";

  lines.push(`\u{1F986}\u{26A1} *DuzzaTip Rd${round} \u2014 ${sendType}*`);
  lines.push(`\u23F0 Lockout: ${timeStr}`);
  if (dryRun) lines.push(`_(dry-run \u2014 nothing saved)_`);
  lines.push("");

  // Team
  lines.push(`\u{1F4CB} *YOUR TEAM*`);
  let totalPts = 0;
  for (const pos of MAIN_POSITIONS) {
    const p = result.lineup[pos];
    if (!p) { lines.push(`  ${POS_SHORT[pos].padEnd(5)} (no player)`); continue; }
    const pts = p.scores[pos] ? Math.round(p.scores[pos]) : "?";
    if (typeof pts === "number") totalPts += pts;
    const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
    lines.push(`  *${POS_SHORT[pos]}*  *${dn(p.name)}* _(${pts}pts)_${inj}`);
  }
  if (result.bench) {
    const p = result.bench;
    const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
    lines.push(`  *BNCH*  *${dn(p.name)}* \u2192 ${POS_SHORT[result.benchBackup] || "?"}${inj}`);
  }
  if (result.reserveA) {
    const p = result.reserveA;
    const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
    lines.push(`  *ResA*  *${dn(p.name)}* (${RESERVE_A_COVERS.map(pp => POS_SHORT[pp]).join("/")})${inj}`);
  }
  if (result.reserveB) {
    const p = result.reserveB;
    const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
    lines.push(`  *ResB*  *${dn(p.name)}* (${RESERVE_B_COVERS.map(pp => POS_SHORT[pp]).join("/")})${inj}`);
  }
  lines.push(`  \u{1F4CA} Projected: ~${totalPts} pts/round`);
  lines.push("");

  // Alerts
  const alerts = [];
  for (const p of (byePlayers || [])) {
    alerts.push(`\u{1F6AB} *BYE*: ${dn(p.name)} (${p.team}) \u2014 not playing Rd${round}`);
  }
  if (selectionStatus) {
    for (const [name, sel] of selectionStatus.entries()) {
      const inj = INJURIES[name];
      if (autoExcluded.has(name) && !(byePlayers || []).some(p => p.name === name)) {
        alerts.push(`\u2717 *OUT* (auto-excluded): ${dn(name)}${inj ? ` \u2014 ${inj.detail}` : ""}`);
      } else if (sel === "emergency") {
        alerts.push(`\u26A1 *EMERG*: ${dn(name)} \u2014 named emergency`);
      } else if (sel === "out") {
        alerts.push(`\u26A0 *NOT NAMED*: ${dn(name)} not in team but still in your lineup \u2014 check!`);
      }
    }
    const allInLineup = [...Object.values(result.lineup), result.bench, result.reserveA, result.reserveB].filter(Boolean);
    for (const p of allInLineup) {
      if (injSeverity(p.name) >= 1 && !autoExcluded.has(p.name)) {
        const inj = INJURIES[p.name];
        alerts.push(`\u26A0 *DOUBT*: ${dn(p.name)} in lineup \u2014 ${inj.detail}`);
      }
    }
  }
  if (alerts.length > 0) {
    lines.push(`\u26A0\uFE0F *ALERTS (${alerts.length})*`);
    for (const a of alerts) lines.push(`  ${a}`);
    lines.push("");
  }

  // Other available
  if (otherAvailable?.length > 0) {
    lines.push(`\u{1F504} *OTHER AVAILABLE (${otherAvailable.length})*`);
    for (const p of otherAvailable) {
      const posStr = p.bestPositions.map(([pos, score]) => `${POS_SHORT[pos]} ${Math.round(score)}`).join(" / ");
      const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
      lines.push(`  ${dn(p.name)}  _(${posStr})_${inj}`);
    }
    lines.push("");
  }

  // Tips
  if (tipSuggestions?.length) {
    lines.push(`\u{1F3C8} *TIPS \u2014 Round ${round}*`);
    for (const t of tipSuggestions) {
      const gameTime = formatGameTime(t.dateUtc);
      const homePick = t.favourite === t.homeTeam;
      const lock = t.suggestDC ? " \u{1F512}" : "";
      const home = homePick ? `\u2705 *${t.homeTeam}* (${t.confidence}%)${lock}` : t.homeTeam;
      const away = homePick ? t.awayTeam : `\u2705 *${t.awayTeam}* (${t.confidence}%)${lock}`;
      lines.push(`  ${home} v ${away}`);
      lines.push(`  _${gameTime}_`);
    }
    lines.push("");

    const dcs = tipSuggestions.filter(t => t.suggestDC);
    if (dcs.length) {
      lines.push(`\u{1F512} *DEAD CERTS (${dcs.length})*`);
      for (const t of dcs) {
        lines.push(`  • *${t.favourite}* _(${t.confidence}%)_`);
      }
    }
    lines.push("");
  }

  // DB status
  if (dryRun) {
    lines.push(`_(dry-run: team + tips NOT saved)_`);
  } else {
    lines.push(savedTeam && savedTips ? `\u2705 Team + tips saved to DB` :
               savedTeam ? `\u2705 Team saved  \u26A0 Tips not saved` :
               savedTips ? `\u26A0 Team not saved  \u2705 Tips saved` :
               `\u26A0 Nothing saved to DB`);
  }

  return lines.join("\n");
}

// ===== Send via Telegram bot API =====
// Uses curl because Node's https module is blocked by Windows firewall/antivirus
function sendTelegram(message, dryRun) {
  if (dryRun) {
    console.log("\n--- MESSAGE PREVIEW ---");
    console.log(message);
    console.log("---\n");
    return Promise.resolve(true);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN not set in .env.local");
    return Promise.resolve(false);
  }

  const { execSync } = require("child_process");
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" });

  try {
    const result = execSync(
      `curl -s -X POST "${url}" -H "Content-Type: application/json" -d @-`,
      { input: body, timeout: 15000, encoding: "utf-8" }
    );
    const parsed = JSON.parse(result || "{}");
    if (parsed.ok) {
      console.log("   Telegram message sent.");
      return Promise.resolve(true);
    } else {
      console.error(`Telegram API error: ${parsed.description || result}`);
      return Promise.resolve(false);
    }
  } catch (e) {
    console.error("Telegram send failed:", e.message);
    return Promise.resolve(false);
  }
}

// ===== Trade report runner =====
async function runTradeReport({ fixtures, dryRun }) {
  console.log("\n\u{1F501} DuzzaTip Trade Report");
  process.stdout.write("   Connecting to MongoDB...");
  const client = new MongoClient(MONGODB_URI, { connectTimeoutMS: 10000 });
  await client.connect();
  const db = client.db("afl_database");
  console.log(" connected");

  const lastRound = getLastCompletedRound(fixtures);
  console.log(`   Latest completed round: ${lastRound}`);

  const events = await loadTradeEvents(db, fixtures);
  console.log(`   Trades found: ${events.length}`);

  const reports = await evaluateTradeEvents(db, fixtures, events, lastRound);
  await client.close();

  // Console summary
  for (const rep of reports) {
    const { ev } = rep;
    const lowN = USER_SHORT[ev.userLow], highN = USER_SHORT[ev.userHigh];
    section(`${ev.day}  ${lowN} v ${highN}  (R${ev.roundEff}-${lastRound})`);
    const fmt = arr => arr.map(p => `${dn(p.name)} ${p.pts}pts (${p.played}g/${p.missed}m)`).join(", ");
    console.log(`  ${lowN} got: ${fmt(rep.low) || "-"}  => ${rep.lowPts}`);
    console.log(`  ${highN} got: ${fmt(rep.high) || "-"}  => ${rep.highPts}`);
    if (rep.winner == null) console.log(`  ${C.yellow}Dead even${C.reset}`);
    else console.log(`  ${C.green}Winner: ${USER_SHORT[rep.winner]} by ${Math.abs(rep.diff)}${C.reset}`);
  }

  const message = buildTradeMessage(reports, lastRound);
  await sendTelegram(message, dryRun);
  console.log("\n✅ Done.");
}

// ===== Main =====
async function main() {
  const args        = process.argv.slice(2);
  const interactive = args.includes("--interactive") || args.includes("-i");
  const dryRun      = args.includes("--dry-run");
  const force       = args.includes("--force");
  const doTeam      = !args.includes("--tips");
  const doTips      = !args.includes("--team");
  const roundArg    = args.find(a => a.startsWith("--round="));
  const tradesOnly  = args.includes("--trades");
  const skipRefresh = args.includes("--no-refresh");

  // Self-heal fixture kickoff times from the authoritative AFL API before
  // anything reads them. The fixture JSON is seeded once at season start with
  // placeholder times for unscheduled rounds, and the AFL moves games all
  // season — a stale DateUtc silently mis-computes the lockout and skips the
  // weekly alert (the exact failure this guards against). Non-fatal: if the AFL
  // API is unreachable we proceed with the existing file. Skip with --no-refresh.
  if (!skipRefresh) {
    try {
      const { refreshFixtures } = require("./refresh-fixtures");
      const res = await refreshFixtures({ verbose: false });
      if (res.ok && res.changes.length > 0) {
        console.log(`  ↻ Fixture refresh: corrected ${res.changes.length} kickoff time(s) from AFL API`);
      } else if (!res.ok) {
        console.warn(`  ⚠ Fixture refresh unavailable (${res.reason}) — using existing fixture file.`);
      }
    } catch (e) {
      console.warn(`  ⚠ Fixture refresh skipped: ${e.message}`);
    }
  }

  const fixtures = loadFixtures();

  // ═══════════════════════════════════════════════
  //  TRADE REPORT  (node lockout-notify.js --trades)
  // ═══════════════════════════════════════════════
  if (tradesOnly) {
    await runTradeReport({ fixtures, dryRun });
    return;
  }

  const round    = roundArg ? parseInt(roundArg.split("=")[1]) : getCurrentRound(fixtures);
  const lockout  = getLockoutInfo(fixtures, round);

  if (interactive) {
    header(`\u{1F986}\u{26A1} Le Quack Attack \u2014 DuzzaTip ${YEAR}`);
    if (dryRun) console.log(`  ${C.yellow}DRY-RUN mode \u2014 nothing will be saved${C.reset}`);
    console.log(`\n  ${C.bold}Round ${round}${C.reset}`);
    if (lockout) {
      if (lockout.locked) {
        console.log(`  ${C.red}\u26A0  Round is LOCKED (first game has started)${C.reset}`);
      } else {
        const hrs = Math.floor(lockout.minsUntil / 60);
        const mins = lockout.minsUntil % 60;
        const col = lockout.minsUntil < 60 ? C.red : lockout.minsUntil < 360 ? C.yellow : C.green;
        console.log(`  ${col}\u23F0 Lockout: ${lockout.melbTime}  (${hrs}h ${mins}m away)${C.reset}`);
      }
    }
  } else {
    console.log(`\n\u{1F986}\u{26A1} DuzzaTip Lockout Notifier \u2014 Round ${round}`);
    if (lockout) {
      const hrs  = Math.floor(lockout.minsUntil / 60);
      const mins = lockout.minsUntil % 60;
      console.log(`   Lockout: ${lockout.melbTime}  (${hrs}h ${mins}m away)`);
    }

    // Gate: two sends per round — "early" (teams announced, >1.5h before lockout)
    // and "final" (within 1.5h of lockout, after late team changes)
    if (!force && !dryRun) {
      if (lockout?.locked) { console.log("   \u2B50 Round already locked \u2014 nothing to do."); return; }
      // Don't trust the "too far away" skip when the round's times look like
      // unrefreshed placeholders \u2014 the real lockout could be much sooner. Warn
      // loudly and fall through to send rather than silently swallowing the alert.
      if (lockout && lockout.hoursUntil > NOTIFY_WINDOW_HOURS && !lockout.placeholder) {
        console.log(`   \u2B50 Lockout is ${Math.round(lockout.hoursUntil)}h away (>${NOTIFY_WINDOW_HOURS}h window) \u2014 skipping.`);
        return;
      }
      if (lockout?.placeholder && lockout.hoursUntil > NOTIFY_WINDOW_HOURS) {
        console.warn(`   \u26A0 Round ${round} kickoff times look like unrefreshed placeholders ` +
          `(AFL refresh may have failed) \u2014 not trusting the ${Math.round(lockout.hoursUntil)}h window; proceeding.`);
      }
      const state = loadState();
      const roundState = state.rounds[round] || {};
      const isFinalWindow = lockout && lockout.minsUntil <= FINAL_WINDOW_MINS;
      if (isFinalWindow && roundState.final) {
        console.log(`   \u2B50 Already sent final notification for Round ${round} \u2014 skipping.`);
        return;
      }
      if (!isFinalWindow && roundState.early) {
        console.log(`   \u2B50 Already sent early notification for Round ${round} (final sends ${FINAL_WINDOW_MINS}min before lockout) \u2014 skipping.`);
        return;
      }
    }
  }

  // Connect to MongoDB
  if (interactive) process.stdout.write(`\n${C.dim}Connecting to MongoDB...${C.reset}`);
  else process.stdout.write("   Connecting to MongoDB...");
  const client = new MongoClient(MONGODB_URI, { connectTimeoutMS: 10000 });
  await client.connect();
  const db = client.db("afl_database");
  if (interactive) console.log(` ${C.green}connected${C.reset}`);
  else console.log(" connected");

  // Load injuries from DB (fall back to static file)
  try {
    const injDoc = await db.collection("injuries").findOne({ _id: `injuries_${YEAR}` });
    if (injDoc?.players && Object.keys(injDoc.players).length > 0) {
      INJURIES = injDoc.players;
      const updated = injDoc.updated ? new Date(injDoc.updated).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne" }) : "?";
      console.log(`   Injuries: ${Object.keys(INJURIES).length} players (DB, updated ${updated})`);
    } else {
      throw new Error("empty");
    }
  } catch (_) {
    try {
      const staticInj = require("./injuries-2026");
      INJURIES = staticInj.INJURIES || {};
      console.log(`   Injuries: ${Object.keys(INJURIES).length} players (static file fallback)`);
    } catch (_2) {
      console.log("   Injuries: none loaded");
    }
  }

  // Load squad
  const squadDocs = await db.collection(`${YEAR}_squads`).find({ user_id: MY_USER, Active: 1 }).toArray();
  if (!squadDocs.length) {
    console.error("No squad found.");
    await client.close();
    return;
  }
  console.log(`   Squad: ${squadDocs.length} players`);

  // Load stats
  process.stdout.write("   Loading stats...");
  const statsMap = await loadPlayerStats(db, squadDocs.map(p => p.player_name));
  console.log(" done");

  const squad = squadDocs.map(p => {
    const s = statsMap[p.player_name];
    const scores = s ? (s.games ? scorePositionsFromGames(s.games) : scoreAllPositions(s.avg)) : {};
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return { name: p.player_name, team: p.team, scores, statsSource: s?.source || null, bestPos: best?.[0] || null, bestScore: best?.[1] || 0 };
  });

  // Fetch AFL team selections
  process.stdout.write("   Fetching team selections...");
  const { selections, source: selSource } = await fetchTeamSelections(round);
  let selectionStatus = null;
  if (selections) {
    console.log(` ${selSource}`);
    selectionStatus = buildSelectionStatus(squad, selections);
  } else {
    console.log(` ${selSource}`);
  }

  // Round fixtures + bye detection
  const roundFixtures = getRoundFixtures(fixtures, round);
  const playingTeams  = getPlayingTeams(roundFixtures);
  const byePlayers    = squad.filter(p => !teamIsPlaying(p.team, playingTeams));
  if (byePlayers.length > 0) {
    console.log(`   Bye this round: ${byePlayers.map(p => `${dn(p.name)} (${p.team})`).join(", ")}`);
  }

  // Auto-exclude: bye + long-term injury + not named
  const autoExcluded = new Set();
  for (const p of squad) {
    const sev = injSeverity(p.name);
    const sel = selectionStatus?.get(p.name);
    if (!teamIsPlaying(p.team, playingTeams)) autoExcluded.add(p.name);
    else if (sev >= 3 || sel === "out") autoExcluded.add(p.name);
  }
  if (autoExcluded.size > 0) {
    console.log(`   Auto-excluded: ${[...autoExcluded].map(dn).join(", ")}`);
  }

  // Setup readline for interactive mode
  let rl, ask;
  if (interactive) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    ask = q => new Promise(r => rl.question(q, r));
  }

  // ═══════════════════════════════════════════════
  //  TEAM SELECTION
  // ═══════════════════════════════════════════════
  let result;
  if (doTeam) {
    if (interactive) {
      // Show squad overview
      section("YOUR SQUAD");
      const sorted = [...squad].sort((a, b) => b.bestScore - a.bestScore);
      for (const p of sorted) {
        const sev = injSeverity(p.name);
        const nc = sev >= 2 ? C.red : sev === 1 ? C.yellow : "";
        const scoreStr = p.bestScore > 0 ? ` ${C.dim}${Math.round(p.bestScore)}pts as ${POS_SHORT[p.bestPos] || "?"}` : ` ${C.dim}no stats`;
        console.log(`  ${nc}${dn(p.name).padEnd(28)}${C.reset}${(p.team || "??").padEnd(5)}${scoreStr}  ${p.statsSource || ""}${C.reset}${injBadge(p.name)}`);
      }

      // Show selection status
      if (selectionStatus) {
        section("AFL TEAM SELECTIONS");
        let anyIssues = false;
        for (const p of sorted) {
          const sel = selectionStatus.get(p.name) || "unknown";
          if (sel === "playing" && injSeverity(p.name) >= 1) {
            console.log(`  ${C.green}\u2714 NAMED   ${dn(p.name).padEnd(28)}${C.reset}${injBadge(p.name)}`);
            anyIssues = true;
          } else if (sel === "emergency") {
            console.log(`  ${C.yellow}\u26A1 EMERG   ${dn(p.name).padEnd(28)}${C.dim}named as emergency${C.reset}${injBadge(p.name)}`);
            anyIssues = true;
          } else if (sel === "out") {
            console.log(`  ${C.red}\u2717 NOT NAMED ${dn(p.name).padEnd(26)}${C.dim}not in ${p.team}'s named 22${C.reset}${injBadge(p.name)}`);
            anyIssues = true;
          } else if (injSeverity(p.name) >= 1) {
            console.log(`  ${C.yellow}? UNKNOWN ${dn(p.name).padEnd(27)}${injBadge(p.name)}`);
            anyIssues = true;
          }
        }
        if (!anyIssues) console.log(`  ${C.green}All squad players named \u2014 no issues found.${C.reset}`);
      }

      // Availability summary
      section("AVAILABILITY SUMMARY");
      let hasFlags = false;
      for (const p of squad) {
        const sev = injSeverity(p.name);
        const sel = selectionStatus?.get(p.name);
        if (sev >= 3) {
          console.log(`  ${C.red}AUTO-OUT  ${dn(p.name).padEnd(28)}${INJURIES[p.name].detail}${C.reset}`);
          hasFlags = true;
        } else if (sel === "out") {
          console.log(`  ${C.red}AUTO-OUT  ${dn(p.name).padEnd(28)}${C.dim}not named in ${p.team}'s team${C.reset}${injBadge(p.name)}`);
          hasFlags = true;
        } else if (sel === "emergency") {
          console.log(`  ${C.yellow}EMERGENCY ${dn(p.name).padEnd(28)}${C.dim}named emergency${C.reset}`);
          hasFlags = true;
        } else if (sev >= 1) {
          console.log(`  ${C.yellow}FLAGGED   ${dn(p.name).padEnd(28)}${INJURIES[p.name].detail}${C.reset}`);
          hasFlags = true;
        }
      }
      if (!hasFlags) console.log(`  ${C.green}All available \u2014 no exclusions needed.${C.reset}`);

      // Manual exclusions
      console.log(`\n  ${C.dim}Any extra players OUT this week? Enter names (comma-separated), or press Enter.${C.reset}`);
      const outInput = await ask(`  OUT this week: `);
      const excluded = new Set(autoExcluded);
      if (outInput.trim()) {
        for (const q of outInput.split(",").map(s => s.trim()).filter(Boolean)) {
          const match = squad.find(p =>
            p.name.toLowerCase().includes(q.toLowerCase()) || dn(p.name).toLowerCase().includes(q.toLowerCase())
          );
          if (match) { excluded.add(match.name); console.log(`  ${C.yellow}Marked OUT: ${dn(match.name)}${C.reset}`); }
          else console.log(`  ${C.red}Not found in squad: "${q}"${C.reset}`);
        }
      }

      // Compute and show optimal lineup
      result = findOptimalLineup(squad, excluded, statsMap, selectionStatus);
      section("OPTIMAL LINEUP");
      printLineup(result, excluded);

      // Warn about risks in lineup
      const allInLineup = [...Object.values(result.lineup), result.bench, result.reserveA, result.reserveB].filter(Boolean);
      const risks = allInLineup.filter(p => injSeverity(p.name) >= 1);
      if (risks.length > 0) {
        console.log(`\n  ${C.yellow}\u26A0 Risks in lineup:${C.reset}`);
        for (const p of risks) console.log(`     ${C.yellow}${dn(p.name)}: ${INJURIES[p.name]?.detail}${C.reset}`);
      }

      // Full score breakdown table
      section("FULL SQUAD SCORE BREAKDOWN");
      console.log(`  ${"Player".padEnd(28)} ${"FF".padEnd(6)} ${"TF".padEnd(6)} ${"OFF".padEnd(6)} ${"MID".padEnd(6)} ${"TAK".padEnd(6)} ${"RUC".padEnd(6)}`);
      console.log(`  ${"-".repeat(66)}`);
      for (const p of sorted) {
        if (!p.bestScore) continue;
        const row = MAIN_POSITIONS.map(pos => String(p.scores[pos] || "\u2013").padEnd(6)).join(" ");
        const excl = excluded.has(p.name) ? ` ${C.red}(OUT)${C.reset}` : "";
        console.log(`  ${dn(p.name).padEnd(28)} ${C.dim}${row}${C.reset}${excl}`);
      }

      // Interactive editing loop
      console.log(`\n  ${C.dim}Commands: Enter=accept | swap <pos> <name> | view | skip${C.reset}`);
      while (true) {
        const input = (await ask(`\n${C.bold}Team > ${C.reset}`)).trim();
        const lower = input.toLowerCase();

        if (!input || lower === "accept" || lower === "y" || lower === "yes") {
          if (dryRun) {
            console.log(`  ${C.yellow}Dry-run: would save team for Round ${round}${C.reset}`);
            break;
          }
          if (lockout?.locked) {
            const fc = (await ask(`  ${C.red}Round is LOCKED. Submit anyway? (y/n): ${C.reset}`)).trim().toLowerCase();
            if (!fc.startsWith("y")) { console.log(`  ${C.yellow}Team not saved.${C.reset}`); break; }
          }
          await saveTeamSelection(db, round, result);
          console.log(`  ${C.bgGreen} \u2714 Team saved for Round ${round}! ${C.reset}`);
          break;

        } else if (lower === "skip" || lower === "q" || lower === "quit") {
          console.log(`  ${C.dim}Skipping team selection.${C.reset}`);
          break;

        } else if (lower === "view") {
          printLineup(result, excluded);

        } else if (lower.startsWith("swap ")) {
          const parts = input.slice(5).trim().split(/\s+/);
          const posKw = parts[0].toLowerCase();
          const nameQ = parts.slice(1).join(" ").toLowerCase();

          const ALL_SLOT_NAMES = [...MAIN_POSITIONS, "Bench", "Reserve A", "Reserve B"];
          const posMatch = ALL_SLOT_NAMES.find(p =>
            p.toLowerCase().includes(posKw) || (POS_SHORT[p] || "").toLowerCase() === posKw
          );
          const playerMatch = squad.find(p =>
            !excluded.has(p.name) &&
            (p.name.toLowerCase().includes(nameQ) || dn(p.name).toLowerCase().includes(nameQ))
          );

          if (!posMatch) { console.log(`  ${C.red}Position not recognised: "${parts[0]}"  (try: ff, tf, off, mid, tak, ruc, bench, resA, resB)${C.reset}`); continue; }
          if (!playerMatch) { console.log(`  ${C.red}Player not found in available squad: "${nameQ}"${C.reset}`); continue; }

          if (MAIN_POSITIONS.includes(posMatch)) {
            result.lineup[posMatch] = playerMatch;
            console.log(`  ${C.green}Set ${posMatch}: ${dn(playerMatch.name)} (${playerMatch.scores[posMatch] || 0}pts)${C.reset}`);
          } else if (posMatch === "Bench") {
            result.bench = playerMatch;
            const bpIn = (await ask(`  Bench backup position (ff/tf/off/mid/tak/ruc): `)).trim().toLowerCase();
            const bp = MAIN_POSITIONS.find(p => p.toLowerCase().includes(bpIn) || (POS_SHORT[p] || "").toLowerCase() === bpIn);
            if (bp) result.benchBackup = bp;
            console.log(`  ${C.green}Bench: ${dn(playerMatch.name)} \u2192 backs up ${result.benchBackup}${C.reset}`);
          } else if (posMatch === "Reserve A") {
            result.reserveA = playerMatch;
            console.log(`  ${C.green}Reserve A: ${dn(playerMatch.name)}${C.reset}`);
          } else if (posMatch === "Reserve B") {
            result.reserveB = playerMatch;
            console.log(`  ${C.green}Reserve B: ${dn(playerMatch.name)}${C.reset}`);
          }
          section("UPDATED LINEUP");
          printLineup(result, excluded);

        } else {
          console.log(`  ${C.dim}Unknown command. Try: Enter, "swap ff Cameron", "swap bench Smith", "view", "skip"${C.reset}`);
        }
      }

    } else {
      // Headless mode — auto lineup
      result = findOptimalLineup(squad, autoExcluded, statsMap, selectionStatus);
      console.log(`   Lineup: ${Object.values(result.lineup).filter(Boolean).map(p => dn(p.name)).join(", ")}`);
    }
  } else {
    // --tips only: still need a result for message building
    result = findOptimalLineup(squad, autoExcluded, statsMap, selectionStatus);
  }

  // ═══════════════════════════════════════════════
  //  TIPPING
  // ═══════════════════════════════════════════════
  let tipSuggestions;
  if (doTips) {
    // Fetch odds (Squiggle + Sportsbet in parallel)
    process.stdout.write(`   Fetching tips for Round ${round}...`);
    const [squiggleTips, sportsbetOdds] = await Promise.all([
      fetchSquiggleTips(round),
      fetchSportsbetOdds(),
    ]);
    const oddsSource = sportsbetOdds ? "Sportsbet" : squiggleTips ? "Squiggle" : "none";
    console.log(` ${squiggleTips ? squiggleTips.length + " Squiggle tips" : "no Squiggle"}${sportsbetOdds ? " + Sportsbet odds" : ""}`);

    tipSuggestions = buildTipSuggestions(roundFixtures, squiggleTips, sportsbetOdds);

    if (interactive) {
      section(`ROUND ${round} TIPPING`);

      console.log(`  ${"#".padEnd(5)}${"Home".padEnd(24)}${"Away".padEnd(24)}${"Tip".padEnd(24)}Odds/Conf`);
      console.log(`  ${"\u2500".repeat(80)}`);
      for (const s of tipSuggestions) {
        const melbDate = formatGameTime(s.dateUtc);
        const oddsStr = s.favOdds ? `$${Number(s.favOdds).toFixed(2)}` : `${s.confidence}%`;
        const dcFlag = s.suggestDC ? ` ${C.yellow}\u2605 suggest DC${C.reset}` : "";
        console.log(`  ${String(s.matchNumber).padEnd(5)}${s.homeTeam.padEnd(24)}${s.awayTeam.padEnd(24)}${C.green}${s.favourite.padEnd(24)}${C.reset}${oddsStr}${dcFlag}`);
        console.log(`  ${C.dim}      ${melbDate}  (${s.source})${C.reset}`);
      }

      // Build mutable tips object
      const tips = {};
      for (const s of tipSuggestions) tips[s.matchNumber] = { team: s.favourite, deadCert: false };
      let deadCertMatch = null;

      console.log(`\n  ${C.dim}Commands: Enter=accept | tip <matchNum> <team> | dc <matchNum> | clear dc | view | skip${C.reset}`);

      while (true) {
        const input = (await ask(`\n${C.bold}Tips > ${C.reset}`)).trim();
        const lower = input.toLowerCase();

        if (!input || lower === "accept" || lower === "y" || lower === "save") {
          // Prompt for dead cert if not set
          if (!deadCertMatch) {
            const sugDC = tipSuggestions.find(s => s.suggestDC);
            if (sugDC) {
              const dcIn = (await ask(`  ${C.yellow}No Dead Cert set. Suggest Match ${sugDC.matchNumber} \u2014 ${tips[sugDC.matchNumber].team} (${sugDC.confidence}%). Set as DC? (y/n): ${C.reset}`)).trim().toLowerCase();
              if (dcIn.startsWith("y")) {
                tips[sugDC.matchNumber].deadCert = true;
                deadCertMatch = sugDC.matchNumber;
              }
            }
          }

          // Show final tips
          section("TIPS TO SAVE");
          for (const s of tipSuggestions) {
            const t = tips[s.matchNumber];
            const dcStr = t.deadCert ? ` ${C.bgYellow} \u2605 DEAD CERT ${C.reset}` : "";
            console.log(`  Match ${String(s.matchNumber).padEnd(4)} ${s.homeTeam.padEnd(22)} v ${s.awayTeam.padEnd(22)} \u2192 ${C.green}${t.team}${C.reset}${dcStr}`);
          }

          if (dryRun) {
            console.log(`  ${C.yellow}Dry-run: would save tips for Round ${round}${C.reset}`);
            break;
          }
          const confirm = (await ask(`\n${C.bold}Save these tips for Round ${round}? (y/n): ${C.reset}`)).trim().toLowerCase();
          if (confirm.startsWith("y")) {
            await saveTips(db, round, tips);
            console.log(`  ${C.bgGreen} \u2714 Tips saved for Round ${round}! ${C.reset}`);
          } else {
            console.log(`  ${C.dim}Tips not saved.${C.reset}`);
          }
          break;

        } else if (lower === "skip" || lower === "q" || lower === "quit") {
          console.log(`  ${C.dim}Skipping tips.${C.reset}`);
          break;

        } else if (lower === "view") {
          for (const s of tipSuggestions) {
            const t = tips[s.matchNumber];
            const dcStr = t.deadCert ? ` ${C.yellow}\u2605 DC${C.reset}` : "";
            console.log(`  ${String(s.matchNumber).padEnd(5)}${s.homeTeam.padEnd(24)} v ${s.awayTeam.padEnd(24)} \u2192 ${C.green}${t.team}${C.reset}${dcStr}`);
          }

        } else if (lower.startsWith("tip ")) {
          const parts = input.slice(4).trim().split(/\s+/);
          const matchNum = parseInt(parts[0]);
          const teamQ = parts.slice(1).join(" ").toLowerCase();
          const fix = roundFixtures.find(f => f.MatchNumber === matchNum);
          if (!fix) { console.log(`  ${C.red}Match ${matchNum} not found.${C.reset}`); continue; }
          if (fix.HomeTeam.toLowerCase().includes(teamQ)) {
            tips[matchNum].team = fix.HomeTeam;
            console.log(`  ${C.green}Match ${matchNum} \u2192 ${fix.HomeTeam}${C.reset}`);
          } else if (fix.AwayTeam.toLowerCase().includes(teamQ)) {
            tips[matchNum].team = fix.AwayTeam;
            console.log(`  ${C.green}Match ${matchNum} \u2192 ${fix.AwayTeam}${C.reset}`);
          } else {
            console.log(`  ${C.red}Team not found in match ${matchNum}. Teams: ${fix.HomeTeam} / ${fix.AwayTeam}${C.reset}`);
          }

        } else if (lower.startsWith("dc ")) {
          const matchNum = parseInt(lower.slice(3));
          if (!tips[matchNum]) { console.log(`  ${C.red}Match ${matchNum} not found.${C.reset}`); continue; }
          if (deadCertMatch) tips[deadCertMatch].deadCert = false;
          tips[matchNum].deadCert = true;
          deadCertMatch = matchNum;
          console.log(`  ${C.yellow}\u2605 Dead Cert \u2192 Match ${matchNum}: ${tips[matchNum].team}${C.reset}`);

        } else if (lower === "clear dc") {
          if (deadCertMatch) { tips[deadCertMatch].deadCert = false; deadCertMatch = null; }
          console.log(`  ${C.dim}Dead Cert cleared.${C.reset}`);

        } else {
          console.log(`  ${C.dim}Unknown command. Try: Enter, tip 8 carlton, dc 6, clear dc, view, skip${C.reset}`);
        }
      }

    } else {
      // Headless mode — auto-save tips + Telegram
    }
  }

  // ═══════════════════════════════════════════════
  //  HEADLESS: Auto-save + Telegram
  // ═══════════════════════════════════════════════
  if (!interactive) {
    let savedTeam = false, savedTips = false;
    if (!dryRun && doTeam) {
      try {
        await saveTeamSelection(db, round, result);
        savedTeam = true;
        console.log("   \u2705 Team selection saved");
      } catch (e) {
        console.error("   \u274C Team save failed:", e.message);
      }
    }
    if (!dryRun && doTips && tipSuggestions) {
      try {
        const tipsToSave = {};
        for (const t of tipSuggestions) {
          tipsToSave[t.matchNumber] = { team: t.favourite, deadCert: !!t.suggestDC };
        }
        await saveTips(db, round, tipsToSave);
        savedTips = true;
        console.log("   \u2705 Tips saved");
      } catch (e) {
        console.error("   \u274C Tips save failed:", e.message);
      }
    }

    await client.close();

    // Other available players (for Telegram message)
    const lineupNames = new Set([
      ...Object.values(result.lineup).filter(Boolean).map(p => p.name),
      result.bench?.name, result.reserveA?.name, result.reserveB?.name
    ].filter(Boolean));
    const otherAvailable = squad
      .filter(p => !lineupNames.has(p.name) && !autoExcluded.has(p.name) && p.scores && Object.keys(p.scores).length > 0)
      .map(p => {
        const bestPositions = Object.entries(p.scores)
          .filter(([pos]) => MAIN_POSITIONS.includes(pos))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        return { ...p, bestPositions };
      })
      .sort((a, b) => (b.bestPositions[0]?.[1] || 0) - (a.bestPositions[0]?.[1] || 0));

    // Format & send Telegram
    const isFinalWindow = lockout && lockout.minsUntil <= FINAL_WINDOW_MINS;
    const message = buildMessage({ round, lockout, result, autoExcluded, byePlayers, selectionStatus, tipSuggestions, otherAvailable, savedTeam, savedTips, dryRun, isFinal: isFinalWindow });
    const sent = await sendTelegram(message, dryRun);

    // Record notification (early or final)
    if (!dryRun && !force && sent) {
      const state = loadState();
      if (!state.rounds[round]) state.rounds[round] = {};
      const isFinalWindow = lockout && lockout.minsUntil <= FINAL_WINDOW_MINS;
      if (isFinalWindow) {
        state.rounds[round].final = true;
        console.log("   Recorded as FINAL notification for Round " + round);
      } else {
        state.rounds[round].early = true;
        console.log("   Recorded as EARLY notification for Round " + round);
      }
      saveState(state);
    }
  } else {
    await client.close();
    rl.close();
  }

  console.log("\n\u2705 Done.");
}

if (require.main === module) {
  main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

// Exported for tests (trade-report logic is pure / DB-injectable).
module.exports = {
  bestGameScore, getLastCompletedRound, getEffectiveRound,
  loadTradeEvents, evaluateTradeEvents, buildTradeMessage,
};

#!/usr/bin/env node
/**
 * DuzzaTip 2026 — Lockout Notification Bot 🦆⚡
 *
 * Runs headlessly before AFL lockout. Sends a Telegram message via @woodenduck_bot with:
 *   - Your optimal team (auto-excluding injured/unnamed players)
 *   - AFL team selection status for your squad players
 *   - Suggested tips with confidence %
 *   - Auto-saves team selection + tips to MongoDB
 *
 * Scheduling: run daily via Task Scheduler — script self-gates on lockout proximity.
 *
 * Setup: add to .env.local →  TELEGRAM_BOT_TOKEN=<your token from BotFather>
 *
 * Usage:
 *   node lockout-notify.js              — auto-detect round, send if lockout ≤36h away
 *   node lockout-notify.js --round=5    — force round 5
 *   node lockout-notify.js --force      — skip the 36h lockout gate (always send)
 *   node lockout-notify.js --dry-run    — compute everything, print message, don't save or send
 */

require("dotenv").config({ path: ".env.local" });

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const { MongoClient } = require("mongodb");
const { INJURIES, INJURY_DISPLAY } = require("./injuries-2026");

// ===== Config =====
const MY_USER  = 4;
const YEAR     = 2026;

// How many hours before lockout to fire (prevents firing days early)
const NOTIFY_WINDOW_HOURS = 36;

// Telegram — bot token comes from .env.local (TELEGRAM_BOT_TOKEN), chat_id is yours
const TELEGRAM_CHAT_ID = "8600335192";

// State file — tracks which rounds we've already sent a notification for
const STATE_FILE = path.join(__dirname, ".notified-rounds.json");

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

// ===== State (already-notified rounds) =====
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch (_) { return { notified: [] }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

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
  return { firstGame, locked: now >= firstGame, minsUntil, hoursUntil, melbTime };
}
function getRoundFixtures(fixtures, round) {
  return fixtures.filter(f => f.RoundNumber === round).sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));
}

// Returns a Set of team name fragments playing in this round (for bye detection)
function getPlayingTeams(roundFixtures) {
  const teams = new Set();
  for (const f of roundFixtures) {
    teams.add(f.HomeTeam);
    teams.add(f.AwayTeam);
  }
  return teams;
}

// Check if a squad player's AFL team is playing this round
function teamIsPlaying(dbTeam, playingTeams) {
  if (!dbTeam) return true; // unknown team — don't exclude
  const dbT = dbTeam.toLowerCase().trim();
  for (const t of playingTeams) {
    if (t.toLowerCase().includes(dbT) || dbT.includes(t.toLowerCase().split(" ")[0])) return true;
  }
  // Also check FW_TEAM_ALIASES aliases against playing team names
  const slug = findFWSlug(dbTeam);
  if (slug) {
    const aliases = FW_TEAM_ALIASES[slug] || [];
    for (const t of playingTeams) {
      if (aliases.some(a => t.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(t.toLowerCase().split(" ")[0]))) return true;
    }
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
async function loadPlayerStats(db, names) {
  const stats = {};
  try {
    const docs = await db.collection(`${YEAR}_game_results`).find({ player_name: { $in: names } }).toArray();
    const byPlayer = {};
    for (const d of docs) {
      if (!byPlayer[d.player_name]) byPlayer[d.player_name] = [];
      byPlayer[d.player_name].push(d);
    }
    for (const [name, games] of Object.entries(byPlayer)) {
      if (games.length >= 1) stats[name] = { source: `2026(${games.length}g)`, games: games.length, avg: calcAvgStats(games) };
    }
  } catch (_) {}

  const needCsv = names.filter(n => !stats[n] || stats[n].games < 3);
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
      if (games.length >= 3) stats[name] = { source: `2025CSV(${games.length}g)`, games: games.length, avg: calcAvgStats(games) };
    }
  }
  return stats;
}

// ===== Optimal lineup =====
function findOptimalLineup(squadPlayers, excluded = new Set()) {
  const pool = squadPlayers.filter(p => !excluded.has(p.name) && p.scores && Object.keys(p.scores).length > 0);
  const assigned = {};
  const used = new Set();
  const remaining = [...MAIN_POSITIONS];

  while (remaining.length > 0) {
    let bestPos = null, bestPlayer = null, bestMargin = -Infinity;
    for (const pos of remaining) {
      const candidates = pool.filter(p => !used.has(p.name)).sort((a, b) => (b.scores[pos] || 0) - (a.scores[pos] || 0));
      if (!candidates.length) continue;
      const top = candidates[0].scores[pos] || 0;
      const second = candidates[1]?.scores[pos] || 0;
      const margin = top - second;
      if (margin > bestMargin || (margin === bestMargin && top > (bestPlayer?.scores[bestPos] || 0))) {
        bestMargin = margin; bestPos = pos; bestPlayer = candidates[0];
      }
    }
    if (!bestPos) break;
    assigned[bestPos] = bestPlayer;
    used.add(bestPlayer.name);
    remaining.splice(remaining.indexOf(bestPos), 1);
  }
  for (const pos of MAIN_POSITIONS) {
    if (!assigned[pos]) {
      const best = pool.filter(p => !used.has(p.name)).sort((a, b) => (b.scores[pos] || 0) - (a.scores[pos] || 0))[0];
      if (best) { assigned[pos] = best; used.add(best.name); }
    }
  }

  const benchCandidates = pool.filter(p => !used.has(p.name))
    .sort((a, b) => Math.max(...Object.values(b.scores)) - Math.max(...Object.values(a.scores)));
  const bench = benchCandidates[0] || null;
  if (bench) used.add(bench.name);

  let benchBackup = MAIN_POSITIONS[0];
  if (bench?.scores) {
    let best = -1;
    for (const pos of MAIN_POSITIONS) {
      if ((bench.scores[pos] || 0) > best) { best = bench.scores[pos]; benchBackup = pos; }
    }
  }

  const resAScore = p => Math.max(...RESERVE_A_COVERS.map(pos => p.scores[pos] || 0));
  const resA = pool.filter(p => !used.has(p.name)).sort((a, b) => resAScore(b) - resAScore(a))[0] || null;
  if (resA) used.add(resA.name);

  const resBScore = p => Math.max(...RESERVE_B_COVERS.map(pos => p.scores[pos] || 0));
  const resB = pool.filter(p => !used.has(p.name)).sort((a, b) => resBScore(b) - resBScore(a))[0] || null;

  return { lineup: assigned, bench, benchBackup, reserveA: resA, reserveB: resB };
}

// ===== Injury helpers =====
function injSeverity(name) {
  const inj = INJURIES[name];
  if (!inj) return 0;
  return { SEASON: 4, MONTHS: 3, WEEKS: 2, DOUBT: 1, MANAGED: 0 }[inj.status] ?? 0;
}

// ===== AFL Team Selections (Footywire) =====
const FW_TEAM_ALIASES = {
  "adelaide-crows":    ["ADE", "Adelaide", "Adelaide Crows"],
  "brisbane-lions":    ["BRL", "BL", "Brisbane", "Brisbane Lions"],
  "carlton":           ["CAR", "Carlton", "Carlton Blues"],
  "collingwood":       ["COL", "Collingwood", "Collingwood Magpies"],
  "essendon":          ["ESS", "Essendon", "Essendon Bombers"],
  "fremantle":         ["FRE", "Fremantle", "Fremantle Dockers"],
  "geelong-cats":      ["GEE", "Geelong", "Geelong Cats"],
  "gold-coast-suns":   ["GCS", "GC", "Gold Coast", "Gold Coast SUNS", "Gold Coast Suns"],
  "gws-giants":        ["GWS", "GWS Giants", "GWS GIANTS", "Greater Western Sydney"],
  "hawthorn":          ["HAW", "Hawthorn", "Hawthorn Hawks"],
  "melbourne":         ["MEL", "Melbourne", "Melbourne Demons"],
  "north-melbourne":   ["NTH", "North", "North Melbourne", "North Melbourne Kangaroos"],
  "port-adelaide":     ["PTA", "Port", "Port Adelaide", "Port Adelaide Power"],
  "richmond":          ["RIC", "Richmond", "Richmond Tigers"],
  "st-kilda":          ["STK", "St Kilda", "St Kilda Saints"],
  "sydney-swans":      ["SYD", "Sydney", "Sydney Swans"],
  "west-coast-eagles": ["WCE", "West Coast", "West Coast Eagles"],
  "western-bulldogs":  ["WBD", "WB", "Western Bulldogs"],
};
function normName(n) {
  return (n || "").toLowerCase().replace(/'/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}
function slugToName(slug) {
  return slug.split("-").map(part => {
    if (!part) return "";
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(" ");
}
function findFWSlug(dbTeam) {
  const dbT = (dbTeam || "").toLowerCase().trim();
  for (const [slug, aliases] of Object.entries(FW_TEAM_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === dbT)) return slug;
  }
  for (const [slug, aliases] of Object.entries(FW_TEAM_ALIASES)) {
    if (aliases.some(a => dbT.includes(a.toLowerCase()) || a.toLowerCase().includes(dbT))) return slug;
    if (slug.replace(/-/g, " ").includes(dbT) || dbT.includes(slug.replace(/-/g, " "))) return slug;
  }
  return null;
}
function playerNameMatches(dbName, fwNames) {
  const norm = normName(dbName);
  return fwNames.some(fw => normName(fw) === norm);
}
function buildSelectionStatus(squadPlayers, fwSelections) {
  const status = new Map();
  for (const p of squadPlayers) {
    const slug = findFWSlug(p.team);
    if (!slug || !fwSelections[slug]) { status.set(p.name, "unknown"); continue; }
    const { named22, emergencies } = fwSelections[slug];
    if (playerNameMatches(p.name, named22)) status.set(p.name, "playing");
    else if (playerNameMatches(p.name, emergencies)) status.set(p.name, "emergency");
    else status.set(p.name, "out");
  }
  return status;
}
async function fetchAFLTeamSelections() {
  try {
    const axios = require("axios");
    const res = await axios.get("https://www.footywire.com/afl/footy/afl_team_selections", {
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-AU,en;q=0.9",
      }
    });
    const html = res.data;
    const result = {};
    const bTagRe = /<b>([^<]{1,60})<\/b>/g;
    const bTags = [];
    let m;
    while ((m = bTagRe.exec(html)) !== null) bTags.push({ pos: m.index, text: m[1].trim() });

    const POS_LABELS = new Set(["FB", "HB", "C", "HF", "FF", "Fol", "Ruck", "BP", "CP"]);
    const markers = bTags
      .filter(b => /^interchange$|^emergenc|^ins$|^outs$/i.test(b.text) || POS_LABELS.has(b.text))
      .map(b => {
        let kind;
        if (/^interchange$/i.test(b.text))  kind = "interchange";
        else if (/^emergenc/i.test(b.text)) kind = "emergencies";
        else if (/^ins$/i.test(b.text))     kind = "interchange";
        else if (/^outs$/i.test(b.text))    kind = "outs";
        else                                kind = "starting18";
        return { pos: b.pos, kind };
      });

    const playerLinkRe = /href="(pp-([a-z0-9-]+)--([a-z0-9-]+))"/g;
    while ((m = playerLinkRe.exec(html)) !== null) {
      const teamSlug = m[2], playerSlug = m[3];
      const fullName = slugToName(playerSlug);
      if (!result[teamSlug]) result[teamSlug] = { named22: [], emergencies: [] };
      let section = "starting18";
      for (const marker of markers) {
        if (marker.pos < m.index) section = marker.kind;
      }
      if (section === "interchange" || section === "starting18") result[teamSlug].named22.push(fullName);
      else if (section === "emergencies") result[teamSlug].emergencies.push(fullName);
    }
    for (const d of Object.values(result)) {
      d.named22 = [...new Set(d.named22)];
      d.emergencies = [...new Set(d.emergencies)];
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch (_) { return null; }
}

// ===== Tips =====
async function fetchSquiggleTips(round) {
  try {
    const axios = require("axios");
    const res = await axios.get(`https://api.squiggle.com.au/?q=tips;year=${YEAR};round=${round}`, {
      timeout: 8000,
      headers: { "User-Agent": "DuzzaTip-Notify/1.0" }
    });
    if (res.data?.tips?.length) return res.data.tips;
  } catch (_) {}
  return null;
}
function buildTipSuggestions(roundFixtures, squiggleTips) {
  const tips = roundFixtures.map(f => {
    let homePct = 50, source = "home-default";
    if (squiggleTips) {
      const candidates = squiggleTips.filter(t =>
        (t.hteam?.toLowerCase().includes(f.HomeTeam.split(" ")[0].toLowerCase()) ||
         f.HomeTeam.toLowerCase().includes((t.hteam || "").split(" ")[0].toLowerCase())) &&
        (t.ateam?.toLowerCase().includes(f.AwayTeam.split(" ")[0].toLowerCase()) ||
         f.AwayTeam.toLowerCase().includes((t.ateam || "").split(" ")[0].toLowerCase()))
      );
      if (candidates.length > 0) {
        homePct = candidates.reduce((a, t) => {
          const explicitHomePct = parseFloat(t.hconfidence);
          if (!Number.isNaN(explicitHomePct)) return a + explicitHomePct;

          const tippedPct = parseFloat(t.confidence);
          if (Number.isNaN(tippedPct)) return a + 50;
          return a + (t.tip === f.HomeTeam ? tippedPct : 100 - tippedPct);
        }, 0) / candidates.length;
        source = `Squiggle(${candidates.length})`;
      }
    }
    const favourite  = homePct >= 50 ? f.HomeTeam : f.AwayTeam;
    const confidence = Math.round(Math.max(homePct, 100 - homePct));
    return { matchNumber: f.MatchNumber, homeTeam: f.HomeTeam, awayTeam: f.AwayTeam, dateUtc: f.DateUtc, favourite, confidence, source };
  });
  // Mark top confidence as suggested dead cert
  const sorted = [...tips].sort((a, b) => b.confidence - a.confidence);
  if (sorted.length > 0) sorted[0].suggestDC = true;
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
  const bulkOps = [
    { updateMany: { filter: { User: MY_USER, Round: round }, update: { $set: { Active: 0 } } } },
    ...Object.entries(tips).map(([matchNum, tip]) => ({
      updateOne: {
        filter: { User: MY_USER, Round: round, MatchNumber: parseInt(matchNum) },
        update: { $set: { Team: tip.team, DeadCert: tip.deadCert || false, Active: 1, LastUpdated: new Date(), IsDefault: false } },
        upsert: true,
      }
    }))
  ];
  await col.bulkWrite(bulkOps, { ordered: false });
  try { await db.collection(`${YEAR}_tipping_ladder_cache`).deleteMany({ year: YEAR, upToRound: { $gte: round } }); } catch (_) {}
}

// ===== Format WhatsApp message =====
function dn(name) {
  if (!name) return name;
  const parts = name.trim().split(" ");
  if (parts.length < 2) return name;
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
}
function injNote(name) {
  const inj = INJURIES[name];
  if (!inj) return "";
  const labels = { SEASON: "OUT SEASON", MONTHS: "OUT MONTHS", WEEKS: "OUT WEEKS", DOUBT: "DOUBT", MANAGED: "managed" };
  return ` [${labels[inj.status] || inj.status}: ${inj.detail}]`;
}
function formatGameTime(dateUtc) {
  return new Date(dateUtc).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true
  });
}

function buildMessage({ round, lockout, result, autoExcluded, byePlayers, selectionStatus, tipSuggestions, savedTeam, savedTips, dryRun }) {
  const lines = [];
  const hrs  = Math.floor(Math.abs(lockout.minsUntil) / 60);
  const mins = Math.abs(lockout.minsUntil) % 60;
  const timeStr = lockout.locked
    ? `LOCKED (game has started)`
    : `${lockout.melbTime}  (${hrs}h ${mins}m away)`;

  lines.push(`🦆⚡ *DuzzaTip Rd${round} — Pre-Lockout Brief*`);
  lines.push(`⏰ Lockout: ${timeStr}`);
  if (dryRun) lines.push(`_(dry-run — nothing saved)_`);
  lines.push("");

  // ── Team ──
  lines.push(`📋 *YOUR TEAM*`);
  let totalPts = 0;
  for (const pos of MAIN_POSITIONS) {
    const p = result.lineup[pos];
    if (!p) { lines.push(`  ${POS_SHORT[pos].padEnd(5)} (no player)`); continue; }
    const pts = p.scores[pos] ? Math.round(p.scores[pos]) : "?";
    if (typeof pts === "number") totalPts += pts;
    const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
    lines.push(`  ${POS_SHORT[pos].padEnd(5)} ${dn(p.name).padEnd(24)} ${pts}pts${inj}`);
  }
  if (result.bench) {
    const p = result.bench;
    const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
    lines.push(`  BNCH  ${dn(p.name).padEnd(24)} → backs up ${POS_SHORT[result.benchBackup] || "?"}${inj}`);
  }
  if (result.reserveA) {
    const p = result.reserveA;
    const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
    lines.push(`  ResA  ${dn(p.name).padEnd(24)} (${RESERVE_A_COVERS.map(p => POS_SHORT[p]).join("/")})${inj}`);
  }
  if (result.reserveB) {
    const p = result.reserveB;
    const inj = injSeverity(p.name) >= 1 ? injNote(p.name) : "";
    lines.push(`  ResB  ${dn(p.name).padEnd(24)} (${RESERVE_B_COVERS.map(p => POS_SHORT[p]).join("/")})${inj}`);
  }
  lines.push(`  📊 Projected: ~${totalPts} pts/round`);
  lines.push("");

  // ── Alerts ──
  const alerts = [];
  // Bye players
  for (const p of (byePlayers || [])) {
    alerts.push(`🚫 *BYE*: ${dn(p.name)} (${p.team}) — not playing Rd${round}`);
  }
  if (selectionStatus) {
    for (const [name, sel] of selectionStatus.entries()) {
      const inj = INJURIES[name];
      if (autoExcluded.has(name) && !(byePlayers || []).some(p => p.name === name)) {
        alerts.push(`✗ *OUT* (auto-excluded): ${dn(name)}${inj ? ` — ${inj.detail}` : ""}`);
      } else if (sel === "emergency") {
        alerts.push(`⚡ *EMERG*: ${dn(name)} — named emergency`);
      } else if (sel === "out") {
        // Not in lineup, not auto-excluded (stats-based exclusion path)
        alerts.push(`⚠ *NOT NAMED*: ${dn(name)} not in team but still in your lineup — check!`);
      }
    }
    // Doubts/flags still in lineup
    const allInLineup = [...Object.values(result.lineup), result.bench, result.reserveA, result.reserveB].filter(Boolean);
    for (const p of allInLineup) {
      if (injSeverity(p.name) >= 1 && !autoExcluded.has(p.name)) {
        const inj = INJURIES[p.name];
        alerts.push(`⚠ *DOUBT*: ${dn(p.name)} in lineup — ${inj.detail}`);
      }
    }
  }
  if (alerts.length > 0) {
    lines.push(`⚠️ *ALERTS (${alerts.length})*`);
    for (const a of alerts) lines.push(`  ${a}`);
    lines.push("");
  }

  // ── Tips ──
  if (tipSuggestions?.length) {
    lines.push(`🏈 *TIPS — Round ${round}*`);
    for (const t of tipSuggestions) {
      const dc   = t.suggestDC ? " 💀DC" : "";
      const gameTime = formatGameTime(t.dateUtc);
      lines.push(`  ${t.favourite}  ${t.confidence}%${dc}  — ${t.homeTeam} v ${t.awayTeam}  (${gameTime})`);
    }
    lines.push("");
  }

  // ── DB status ──
  if (dryRun) {
    lines.push(`_(dry-run: team + tips NOT saved)_`);
  } else {
    lines.push(savedTeam && savedTips ? `✅ Team + tips saved to DB` :
               savedTeam ? `✅ Team saved  ⚠ Tips not saved` :
               savedTips ? `⚠ Team not saved  ✅ Tips saved` :
               `⚠ Nothing saved to DB`);
  }

  return lines.join("\n");
}

// ===== Send via Telegram bot API =====
function sendTelegram(message, dryRun) {
  if (dryRun) {
    console.log("\n─── MESSAGE PREVIEW ─────────────────────────────────");
    console.log(message);
    console.log("─────────────────────────────────────────────────────\n");
    return Promise.resolve(true);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN not set in .env.local");
    return Promise.resolve(false);
  }

  const body = JSON.stringify({
    chat_id:    TELEGRAM_CHAT_ID,
    text:       message,
    parse_mode: "Markdown",
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${token}/sendMessage`,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        const parsed = JSON.parse(data || "{}");
        if (parsed.ok) {
          console.log("   📨 Telegram message sent.");
          resolve(true);
        } else {
          console.error(`❌ Telegram API error: ${parsed.description || data}`);
          resolve(false);
        }
      });
    });
    req.on("error", e => { console.error("❌ Telegram send failed:", e.message); resolve(false); });
    req.write(body);
    req.end();
  });
}

// ===== Main =====
async function main() {
  const args    = process.argv.slice(2);
  const dryRun  = args.includes("--dry-run");
  const force   = args.includes("--force");
  const roundArg = args.find(a => a.startsWith("--round="));

  const fixtures = loadFixtures();
  const round    = roundArg ? parseInt(roundArg.split("=")[1]) : getCurrentRound(fixtures);
  const lockout  = getLockoutInfo(fixtures, round);

  console.log(`\n🦆⚡ DuzzaTip Lockout Notifier — Round ${round}`);
  if (lockout) {
    const hrs  = Math.floor(lockout.minsUntil / 60);
    const mins = lockout.minsUntil % 60;
    console.log(`   Lockout: ${lockout.melbTime}  (${hrs}h ${mins}m away)`);
  }

  // ── Gate: only fire within NOTIFY_WINDOW_HOURS of lockout ──
  if (!force && !dryRun) {
    if (lockout?.locked) {
      console.log("   ⏭  Round already locked — nothing to do.");
      return;
    }
    if (lockout && lockout.hoursUntil > NOTIFY_WINDOW_HOURS) {
      console.log(`   ⏭  Lockout is ${Math.round(lockout.hoursUntil)}h away (>${NOTIFY_WINDOW_HOURS}h window) — skipping.`);
      return;
    }
    // Check if we already notified for this round
    const state = loadState();
    if (state.notified.includes(round)) {
      console.log(`   ⏭  Already sent notification for Round ${round} — skipping.`);
      return;
    }
  }

  // ── Connect to MongoDB ──
  process.stdout.write("   Connecting to MongoDB...");
  const client = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 10000 });
  await client.connect();
  const db = client.db("afl_database");
  console.log(" connected");

  // ── Load squad ──
  const squadDocs = await db.collection(`${YEAR}_squads`)
    .find({ user_id: MY_USER, Active: 1 }).toArray();

  if (!squadDocs.length) {
    console.error(`❌ No squad found for user ${MY_USER} (${YEAR}).`);
    await client.close();
    return;
  }
  console.log(`   Squad: ${squadDocs.length} players`);

  // ── Load stats ──
  process.stdout.write("   Loading stats...");
  const statsMap = await loadPlayerStats(db, squadDocs.map(p => p.player_name));
  console.log(" done");

  const squad = squadDocs.map(p => {
    const s = statsMap[p.player_name];
    const scores = s ? scoreAllPositions(s.avg) : {};
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return { name: p.player_name, team: p.team, scores, statsSource: s?.source || null, bestPos: best?.[0] || null, bestScore: best?.[1] || 0 };
  });

  // ── Fetch AFL team selections ──
  process.stdout.write("   Fetching AFL team selections (Footywire)...");
  const fwSelections = await fetchAFLTeamSelections();
  let selectionStatus = null;
  if (fwSelections) {
    console.log(` ${Object.keys(fwSelections).length} teams`);
    selectionStatus = buildSelectionStatus(squad, fwSelections);
  } else {
    console.log(" unavailable (not announced yet or site unreachable)");
  }

  // ── Round fixtures + bye detection ──
  const roundFixtures = getRoundFixtures(fixtures, round);
  const playingTeams  = getPlayingTeams(roundFixtures);
  const byePlayers    = squad.filter(p => !teamIsPlaying(p.team, playingTeams));
  if (byePlayers.length > 0) {
    console.log(`   Bye this round: ${byePlayers.map(p => `${dn(p.name)} (${p.team})`).join(", ")}`);
  }

  // ── Auto-exclude: bye + long-term injury + not named ──
  const autoExcluded = new Set();
  for (const p of squad) {
    const sev = injSeverity(p.name);
    const sel = selectionStatus?.get(p.name);
    if (!teamIsPlaying(p.team, playingTeams)) autoExcluded.add(p.name); // bye
    else if (sev >= 3 || sel === "out") autoExcluded.add(p.name);       // injured / not named
  }
  if (autoExcluded.size > 0) {
    console.log(`   Auto-excluded: ${[...autoExcluded].map(dn).join(", ")}`);
  }

  // ── Optimal lineup ──
  const result = findOptimalLineup(squad, autoExcluded);
  console.log(`   Lineup: ${Object.values(result.lineup).filter(Boolean).map(p => dn(p.name)).join(", ")}`);

  // ── Tips ──
  process.stdout.write(`   Fetching Squiggle tips for Round ${round}...`);
  const squiggleTips  = await fetchSquiggleTips(round);
  console.log(squiggleTips ? ` ${squiggleTips.length} tips` : " unavailable");
  const tipSuggestions = buildTipSuggestions(roundFixtures, squiggleTips);

  // ── Save to DB ──
  let savedTeam = false, savedTips = false;
  if (!dryRun) {
    try {
      await saveTeamSelection(db, round, result);
      savedTeam = true;
      console.log("   ✅ Team selection saved");
    } catch (e) {
      console.error("   ❌ Team save failed:", e.message);
    }
    try {
      const tipsToSave = {};
      for (const [i, t] of tipSuggestions.entries()) {
        tipsToSave[t.matchNumber] = { team: t.favourite, deadCert: !!t.suggestDC };
      }
      await saveTips(db, round, tipsToSave);
      savedTips = true;
      console.log("   ✅ Tips saved");
    } catch (e) {
      console.error("   ❌ Tips save failed:", e.message);
    }
  }

  await client.close();

  // ── Format & send message ──
  const message = buildMessage({ round, lockout, result, autoExcluded, byePlayers, selectionStatus, tipSuggestions, savedTeam, savedTips, dryRun });

  const sent = await sendTelegram(message, dryRun);

  // ── Record notification so we don't double-send ──
  if (!dryRun && !force && sent) {
    const state = loadState();
    if (!state.notified.includes(round)) {
      state.notified.push(round);
      // Keep only last 5 rounds in state
      if (state.notified.length > 5) state.notified = state.notified.slice(-5);
      saveState(state);
    }
  }

  console.log("\n✅ Done.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

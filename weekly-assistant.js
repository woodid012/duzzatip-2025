#!/usr/bin/env node
/**
 * DuzzaTip 2026 — Weekly Team & Tipping Assistant 🦆⚡
 *
 * Usage:
 *   node weekly-assistant.js              — team selection + tipping
 *   node weekly-assistant.js --team       — team selection only
 *   node weekly-assistant.js --tips       — tipping only
 *   node weekly-assistant.js --round=5    — force a specific round
 *   node weekly-assistant.js --dry-run    — show suggestions without saving
 */

require("dotenv").config({ path: ".env.local" });

const fs = require("fs");
const readline = require("readline");
const { MongoClient } = require("mongodb");
const { INJURIES, INJURY_DISPLAY } = require("./injuries-2026");

// ===== Config =====
const MY_USER = 4;
const YEAR = 2026;

// ===== Scoring formulas (match scoring_rules.jsx) =====
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

const MAIN_POSITIONS = ["Full Forward", "Tall Forward", "Offensive", "Midfielder", "Tackler", "Ruck"];
const POS_SHORT = { "Full Forward": "FF", "Tall Forward": "TF", "Offensive": "OFF", "Midfielder": "MID", "Tackler": "TAK", "Ruck": "RUC" };
const RESERVE_A_COVERS = ["Full Forward", "Tall Forward", "Ruck"];
const RESERVE_B_COVERS = ["Offensive", "Midfielder", "Tackler"];

// ===== Display helpers =====
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

// ===== Fixtures =====
function loadFixtures() {
  const path = `./public/afl-${YEAR}.json`;
  if (!fs.existsSync(path)) throw new Error(`Fixture file not found: ${path}`);
  return JSON.parse(fs.readFileSync(path, "utf8"));
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
  const melbTime = firstGame.toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true
  });
  return { firstGame, locked: now >= firstGame, minsUntil, melbTime };
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

  // 1. Try 2026 in-season game results
  try {
    const docs = await db.collection(`${YEAR}_game_results`)
      .find({ player_name: { $in: names } })
      .toArray();
    const byPlayer = {};
    for (const d of docs) {
      if (!byPlayer[d.player_name]) byPlayer[d.player_name] = [];
      byPlayer[d.player_name].push(d);
    }
    for (const [name, games] of Object.entries(byPlayer)) {
      if (games.length >= 1) {
        stats[name] = { source: `2026(${games.length}g)`, games: games.length, avg: calcAvgStats(games) };
      }
    }
  } catch (_) { /* no 2026 data yet */ }

  // 2. Fall back to 2025 CSV for players lacking 2026 data
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
      if (games.length >= 3) {
        stats[name] = { source: `2025CSV(${games.length}g)`, games: games.length, avg: calcAvgStats(games) };
      }
    }
  }

  return stats;
}

// ===== Optimal lineup =====
// Greedy max-margin assignment: assign positions where the top player has the
// biggest advantage over the next best, so the best players lock in scarce spots first.
function findOptimalLineup(squadPlayers, excluded = new Set()) {
  const pool = squadPlayers.filter(p => !excluded.has(p.name) && p.scores && Object.keys(p.scores).length > 0);

  const assigned = {}; // pos -> player
  const used = new Set();
  const remaining = [...MAIN_POSITIONS];

  while (remaining.length > 0) {
    let bestPos = null, bestPlayer = null, bestMargin = -Infinity;
    for (const pos of remaining) {
      const candidates = pool.filter(p => !used.has(p.name))
        .sort((a, b) => (b.scores[pos] || 0) - (a.scores[pos] || 0));
      if (!candidates.length) continue;
      const top = candidates[0].scores[pos] || 0;
      const second = candidates[1]?.scores[pos] || 0;
      const margin = top - second;
      if (margin > bestMargin || (margin === bestMargin && top > (bestPlayer?.scores[bestPos] || 0))) {
        bestMargin = margin;
        bestPos = pos;
        bestPlayer = candidates[0];
      }
    }
    if (!bestPos) break;
    assigned[bestPos] = bestPlayer;
    used.add(bestPlayer.name);
    remaining.splice(remaining.indexOf(bestPos), 1);
  }

  // Fill any still-empty positions with best available
  for (const pos of MAIN_POSITIONS) {
    if (!assigned[pos]) {
      const best = pool.filter(p => !used.has(p.name))
        .sort((a, b) => (b.scores[pos] || 0) - (a.scores[pos] || 0))[0];
      if (best) { assigned[pos] = best; used.add(best.name); }
    }
  }

  // Bench: best remaining player overall
  const benchCandidates = pool.filter(p => !used.has(p.name))
    .sort((a, b) => Math.max(...Object.values(b.scores)) - Math.max(...Object.values(a.scores)));
  const bench = benchCandidates[0] || null;
  if (bench) used.add(bench.name);

  // Bench backup: position where bench player scores highest (and is actually helpful)
  let benchBackup = MAIN_POSITIONS[0];
  if (bench && bench.scores) {
    let best = -1;
    for (const pos of MAIN_POSITIONS) {
      if ((bench.scores[pos] || 0) > best) { best = bench.scores[pos]; benchBackup = pos; }
    }
  }

  // Reserve A (covers FF, TF, RUC): best specialist from remaining
  const resAScore = p => Math.max(...RESERVE_A_COVERS.map(pos => p.scores[pos] || 0));
  const resA = pool.filter(p => !used.has(p.name)).sort((a, b) => resAScore(b) - resAScore(a))[0] || null;
  if (resA) used.add(resA.name);

  // Reserve B (covers OFF, MID, TAK): best specialist from remaining
  const resBScore = p => Math.max(...RESERVE_B_COVERS.map(pos => p.scores[pos] || 0));
  const resB = pool.filter(p => !used.has(p.name)).sort((a, b) => resBScore(b) - resBScore(a))[0] || null;

  return { lineup: assigned, bench, benchBackup, reserveA: resA, reserveB: resB };
}

// ===== Display lineup =====
function printLineup(result, excluded = new Set()) {
  let total = 0;
  const rows = [
    ...MAIN_POSITIONS.map(pos => ({ label: pos, player: result.lineup[pos], score: result.lineup[pos]?.scores[pos] })),
    { label: "Bench", player: result.bench, extra: `→ backs up ${result.benchBackup || "?"}` },
    { label: "Reserve A", player: result.reserveA, extra: `covers ${RESERVE_A_COVERS.map(p => POS_SHORT[p]).join("/")}` },
    { label: "Reserve B", player: result.reserveB, extra: `covers ${RESERVE_B_COVERS.map(p => POS_SHORT[p]).join("/")}` },
  ];

  for (const { label, player, score, extra } of rows) {
    if (!player) {
      console.log(`  ${C.red}${label.padEnd(14)} (no player available)${C.reset}`);
      continue;
    }
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

// ===== AFL Team Selections (Footywire) =====
// Maps footywire team slugs → team abbreviations/aliases used in our squad DB
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

// Normalise a name for fuzzy matching (lowercase, letters/spaces only)
function normName(n) {
  return (n || "").toLowerCase().replace(/'/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

// Convert footywire player slug to full name: "rhys-stanley" → "Rhys Stanley"
// Handles common edge cases: mc, o', d', de, van, etc.
function slugToName(slug) {
  return slug.split("-").map(part => {
    if (!part) return "";
    // Common prefixes that stay lowercase in names
    if (["de", "van", "der", "le", "la", "du"].includes(part)) return part.charAt(0).toUpperCase() + part.slice(1);
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(" ");
}

/**
 * Fetches AFL team selections from Footywire.
 *
 * Page HTML structure per team (two parallel columns):
 *   LEFT TABLE:  <b>Interchange</b> → pp- links (4 players)
 *                <b>Emergencies</b> → pp- links (3 players)
 *                <b>Ins</b> / <b>Outs</b> → pp- links
 *   RIGHT TABLE: <b>FB</b> <b>C O'Sullivan</b> ... (starting 18, abbreviated names in <b> tags)
 *
 * Returns: { [fwTeamSlug]: { named22: string[], abbrevNamed22: string[], emergencies: string[] } }
 *   named22      = full names from interchange pp- slugs
 *   abbrevNamed22= abbreviated names ("C O'Sullivan") from starting-18 <b> tags
 *   emergencies  = full names from emergency pp- slugs
 */
async function fetchAFLTeamSelections() {
  try {
    const axios = require("axios");
    const url = "https://www.footywire.com/afl/footy/afl_team_selections";
    const res = await axios.get(url, {
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-AU,en;q=0.9",
      }
    });

    const html = res.data;

    // ── HTML structure (per match, two table columns) ───────────────────────
    // WIDE column (starting 18, in document order AFTER the narrow column):
    //   <b>FB</b> <a href="pp-team--player"><b>C O'Sullivan</b></a> ...
    //   position labels + pp- links (some teams wrap name in <b>, some don't)
    //
    // NARROW column (18% width, BEFORE the wide column in document order):
    //   <b>Interchange</b>  → pp- links (4 players, named22)
    //   <b>Emergencies</b>  → pp- links (3 players, not confirmed)
    //   <b>Ins</b>          → pp- links (duplicates of interchange)
    //   <b>Outs</b>         → pp- links (dropped players)
    //
    // Document order of pp- links (two-match GF page example):
    //   1. [NARROW col] Team A interchange pp- links
    //   2. [NARROW col] Team A emergencies pp- links
    //   3. [NARROW col] Team A ins pp- links
    //   4. [NARROW col] Team A outs pp- links
    //   5. [WIDE col]   Team A starting 18 pp- links    ← come AFTER Outs marker
    //   6. [WIDE col]   Team B starting 18 pp- links    ← before Team B Interchange
    //   7. [NARROW col] Team B interchange pp- links
    //   ...
    // ────────────────────────────────────────────────────────────────────────

    const result = {}; // fwSlug -> { named22: string[], emergencies: string[] }

    // Collect all <b> tags (section markers + position labels)
    const bTagRe = /<b>([^<]{1,60})<\/b>/g;
    const bTags = [];
    let m;
    while ((m = bTagRe.exec(html)) !== null) bTags.push({ pos: m.index, text: m[1].trim() });

    // Position labels that signal entry into the starting-18 table
    const POS_LABELS = new Set(["FB", "HB", "C", "HF", "FF", "Fol", "Ruck", "BP", "CP"]);

    // Build a unified section marker list (interchange, emergencies, ins, outs, starting18)
    const markers = bTags
      .filter(b => /^interchange$|^emergenc|^ins$|^outs$/i.test(b.text) || POS_LABELS.has(b.text))
      .map(b => {
        let kind;
        if (/^interchange$/i.test(b.text))   kind = "interchange";
        else if (/^emergenc/i.test(b.text))  kind = "emergencies";
        else if (/^ins$/i.test(b.text))      kind = "interchange"; // Ins = newly named = playing
        else if (/^outs$/i.test(b.text))     kind = "outs";
        else                                 kind = "starting18"; // position label
        return { pos: b.pos, kind };
      });

    // For each pp- link, find the most recent section marker before it
    const playerLinkRe = /href="(pp-([a-z0-9-]+)--([a-z0-9-]+))"/g;
    while ((m = playerLinkRe.exec(html)) !== null) {
      const teamSlug = m[2], playerSlug = m[3];
      const fullName = slugToName(playerSlug);
      if (!result[teamSlug]) result[teamSlug] = { named22: [], emergencies: [] };

      let section = "starting18"; // default: no prior marker → in wide column (starting 18)
      for (const marker of markers) {
        if (marker.pos < m.index) section = marker.kind;
      }

      if (section === "interchange" || section === "starting18") {
        result[teamSlug].named22.push(fullName);
      } else if (section === "emergencies") {
        result[teamSlug].emergencies.push(fullName);
      }
      // "ins" and "outs" are intentionally skipped
    }

    // Deduplicate (Ins section duplicates interchange players)
    for (const d of Object.values(result)) {
      d.named22 = [...new Set(d.named22)];
      d.emergencies = [...new Set(d.emergencies)];
    }

    const teamCount = Object.keys(result).length;
    if (teamCount === 0) return null;
    return result;

  } catch (e) {
    return null;
  }
}

/**
 * Check if a player matches against a list of full names (from pp- slugs).
 * dbName: full name e.g. "Connor O'Sullivan"
 * fwNames: ["Rhys Stanley", "Jack Bowes", ...]
 */
function playerNameMatches(dbName, fwNames) {
  const norm = normName(dbName);
  return fwNames.some(fw => normName(fw) === norm);
}

/**
 * Check if a player matches an abbreviated name like "C O'Sullivan".
 * Matches if first initial + surname match.
 * e.g. "Connor O'Sullivan" matches "C O'Sullivan"
 */
function playerMatchesAbbrev(dbName, abbrevNames) {
  const parts = (dbName || "").trim().split(/\s+/);
  if (parts.length < 2) return false;
  const initial = parts[0].charAt(0).toUpperCase();
  const surname = parts[parts.length - 1];
  const normSurname = normName(surname);

  return abbrevNames.some(abbrev => {
    const ap = abbrev.trim().split(/\s+/);
    if (ap.length < 2) return false;
    const aInitial = ap[0].charAt(0).toUpperCase();
    const aSurname = ap.slice(1).join(" ");
    return aInitial === initial && normName(aSurname) === normSurname;
  });
}

/**
 * Given a player's team abbreviation/name from our DB, find the matching footywire slug.
 */
function findFWSlug(dbTeam) {
  const dbT = (dbTeam || "").toLowerCase().trim();
  for (const [slug, aliases] of Object.entries(FW_TEAM_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === dbT)) return slug;
  }
  // Partial match fallback
  for (const [slug, aliases] of Object.entries(FW_TEAM_ALIASES)) {
    if (aliases.some(a => dbT.includes(a.toLowerCase()) || a.toLowerCase().includes(dbT))) return slug;
    if (slug.replace(/-/g, " ").includes(dbT) || dbT.includes(slug.replace(/-/g, " "))) return slug;
  }
  return null;
}

/**
 * For each squad player, determine their selection status.
 * Returns: Map<playerName, "playing" | "emergency" | "out" | "unknown">
 */
function buildSelectionStatus(squadPlayers, fwSelections) {
  const status = new Map();
  for (const p of squadPlayers) {
    const slug = findFWSlug(p.team);
    if (!slug || !fwSelections[slug]) {
      status.set(p.name, "unknown");
      continue;
    }
    const { named22, emergencies } = fwSelections[slug];
    if (playerNameMatches(p.name, named22)) {
      status.set(p.name, "playing");
    } else if (playerNameMatches(p.name, emergencies)) {
      status.set(p.name, "emergency");
    } else {
      status.set(p.name, "out");
    }
  }
  return status;
}

// ===== Fetch Squiggle tips (win probabilities) =====
async function fetchSquiggleTips(round) {
  try {
    const axios = require("axios");
    const url = `https://api.squiggle.com.au/?q=tips;year=${YEAR};round=${round}`;
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "DuzzaTip-Weekly/1.0 (afl fantasy assistant)" }
    });
    if (res.data?.tips?.length) return res.data.tips;
  } catch (_) {}
  return null;
}

// ===== Fetch Sportsbet odds =====
async function fetchSportsbetOdds(round) {
  try {
    const axios = require("axios");
    const cheerio = require("cheerio");
    const url = "https://www.sportsbet.com.au/betting/australian-rules";
    const res = await axios.get(url, {
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      }
    });
    const $ = cheerio.load(res.data);
    const odds = {};

    // Try multiple possible Sportsbet DOM patterns
    $("[data-automation-id]").each((_, el) => {
      const id = $(el).attr("data-automation-id") || "";
      if (id.includes("price") || id.includes("participant")) {
        const text = $(el).text().trim();
        const price = parseFloat(text);
        if (!isNaN(price) && price > 1) {
          // Look for adjacent team name
          const name = $(el).closest("[data-automation-id*='event']").find("[data-automation-id*='name']").first().text().trim();
          if (name) odds[name] = price;
        }
      }
    });

    // Alternative: look for JSON data embedded in <script> tags
    if (Object.keys(odds).length === 0) {
      $("script").each((_, el) => {
        const txt = $(el).html() || "";
        const match = txt.match(/"name"\s*:\s*"([^"]+)"[^}]+"win"\s*:\s*(\d+\.?\d*)/g);
        if (match) {
          match.forEach(m => {
            const nm = m.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
            const price = parseFloat(m.match(/"win"\s*:\s*(\d+\.?\d*)/)?.[1]);
            if (nm && !isNaN(price) && price > 1) odds[nm] = price;
          });
        }
      });
    }

    if (Object.keys(odds).length > 0) return odds;
  } catch (_) {}
  return null;
}

// ===== Build tip suggestions =====
function buildTipSuggestions(roundFixtures, squiggleTips, sportsbetOdds) {
  const tips = roundFixtures.map(f => {
    let homePct = 50, source = "default (home)";
    let homeOdds = null, awayOdds = null;

    // Try Squiggle (gives win probability 0-100 for home team per tipster)
    if (squiggleTips) {
      // Squiggle aggregates multiple tipsters — use the FPTA (machine learning) one if available
      const candidates = squiggleTips.filter(t =>
        t.gameid && (
          t.hteam?.toLowerCase().includes(f.HomeTeam.split(" ")[0].toLowerCase()) ||
          f.HomeTeam.toLowerCase().includes((t.hteam || "").split(" ")[0].toLowerCase())
        ) && (
          t.ateam?.toLowerCase().includes(f.AwayTeam.split(" ")[0].toLowerCase()) ||
          f.AwayTeam.toLowerCase().includes((t.ateam || "").split(" ")[0].toLowerCase())
        )
      );
      if (candidates.length > 0) {
        // Average confidence across tipsters for this game
        const avgConf = candidates.reduce((a, t) => a + (parseFloat(t.confidence) || 50), 0) / candidates.length;
        homePct = avgConf;
        source = `Squiggle(${candidates.length} tipsters)`;
      }
    }

    // Try Sportsbet (direct odds)
    if (sportsbetOdds) {
      const homeKey = Object.keys(sportsbetOdds).find(k =>
        f.HomeTeam.toLowerCase().includes(k.toLowerCase().split(" ")[0]) ||
        k.toLowerCase().includes(f.HomeTeam.toLowerCase().split(" ")[0])
      );
      const awayKey = Object.keys(sportsbetOdds).find(k =>
        f.AwayTeam.toLowerCase().includes(k.toLowerCase().split(" ")[0]) ||
        k.toLowerCase().includes(f.AwayTeam.toLowerCase().split(" ")[0])
      );
      if (homeKey && awayKey) {
        homeOdds = sportsbetOdds[homeKey];
        awayOdds = sportsbetOdds[awayKey];
        // Convert to implied probability (normalised)
        const hProb = 1 / homeOdds;
        const aProb = 1 / awayOdds;
        homePct = Math.round((hProb / (hProb + aProb)) * 100);
        source = `Sportsbet ($${homeOdds}/$${awayOdds})`;
      }
    }

    const favourite = homePct >= 50 ? f.HomeTeam : f.AwayTeam;
    const confidence = Math.round(Math.max(homePct, 100 - homePct));
    const favOdds = favourite === f.HomeTeam ? homeOdds : awayOdds;

    return {
      matchNumber: f.MatchNumber,
      homeTeam: f.HomeTeam,
      awayTeam: f.AwayTeam,
      dateUtc: f.DateUtc,
      favourite,
      homeOdds,
      awayOdds,
      confidence,
      favOdds,
      source,
    };
  });

  // Flag highest-confidence match as suggested dead cert
  const sorted = [...tips].sort((a, b) => b.confidence - a.confidence);
  if (sorted.length > 0) sorted[0].suggestDC = true;
  return tips;
}

// ===== Save team selection =====
async function saveTeamSelection(db, round, result) {
  const col = db.collection(`${YEAR}_team_selection`);
  const bulkOps = [
    { updateMany: { filter: { Round: round, User: MY_USER }, update: { $set: { Active: 0 } } } },
  ];

  const toSave = [
    ...MAIN_POSITIONS.map(pos => result.lineup[pos] ? { pos, name: result.lineup[pos].name } : null),
    result.bench ? { pos: "Bench", name: result.bench.name, backup: result.benchBackup } : null,
    result.reserveA ? { pos: "Reserve A", name: result.reserveA.name } : null,
    result.reserveB ? { pos: "Reserve B", name: result.reserveB.name } : null,
  ].filter(Boolean);

  for (const { pos, name, backup } of toSave) {
    bulkOps.push({
      updateOne: {
        filter: { Round: round, User: MY_USER, Position: pos },
        update: {
          $set: {
            Player_Name: name, Position: pos, Round: round, User: MY_USER,
            ...(pos === "Bench" && backup ? { Backup_Position: backup } : {}),
            Active: 1, Last_Updated: new Date(),
          }
        },
        upsert: true,
      }
    });
  }

  await col.bulkWrite(bulkOps, { ordered: false });
}

// ===== Save tips =====
async function saveTips(db, round, tips) {
  const col = db.collection(`${YEAR}_tips`);
  const bulkOps = [
    { updateMany: { filter: { User: MY_USER, Round: round }, update: { $set: { Active: 0 } } } },
    ...Object.entries(tips).map(([matchNum, tip]) => ({
      updateOne: {
        filter: { User: MY_USER, Round: round, MatchNumber: parseInt(matchNum) },
        update: {
          $set: { Team: tip.team, DeadCert: tip.deadCert || false, Active: 1, LastUpdated: new Date(), IsDefault: false }
        },
        upsert: true,
      }
    }))
  ];
  await col.bulkWrite(bulkOps, { ordered: false });

  // Invalidate tipping ladder cache
  try {
    await db.collection(`${YEAR}_tipping_ladder_cache`)
      .deleteMany({ year: YEAR, upToRound: { $gte: round } });
  } catch (_) {}
}

// ===== Main =====
async function main() {
  const args = process.argv.slice(2);
  const doTeam  = !args.includes("--tips");
  const doTips  = !args.includes("--team");
  const dryRun  = args.includes("--dry-run");
  const roundArg = args.find(a => a.startsWith("--round="));

  const fixtures = loadFixtures();
  const round = roundArg ? parseInt(roundArg.split("=")[1]) : getCurrentRound(fixtures);
  const lockout = getLockoutInfo(fixtures, round);

  header(`🦆⚡ Le Quack Attack — DuzzaTip ${YEAR} Weekly Assistant`);

  if (dryRun) console.log(`  ${C.yellow}DRY-RUN mode — nothing will be saved${C.reset}`);

  console.log(`\n  ${C.bold}Round ${round}${C.reset}`);
  if (lockout) {
    if (lockout.locked) {
      console.log(`  ${C.red}⚠  Round is LOCKED (first game has started)${C.reset}`);
    } else {
      const hrs = Math.floor(lockout.minsUntil / 60);
      const mins = lockout.minsUntil % 60;
      const col = lockout.minsUntil < 60 ? C.red : lockout.minsUntil < 360 ? C.yellow : C.green;
      console.log(`  ${col}⏰ Lockout: ${lockout.melbTime}  (${hrs}h ${mins}m away)${C.reset}`);
    }
  }

  // Connect to DB
  process.stdout.write(`\n${C.dim}Connecting to MongoDB...${C.reset}`);
  const client = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 10000 });
  await client.connect();
  const db = client.db("afl_database");
  console.log(` ${C.green}connected${C.reset}`);

  // Load squad
  const squadDocs = await db.collection(`${YEAR}_squads`)
    .find({ user_id: MY_USER, Active: 1 }).toArray();

  if (!squadDocs.length) {
    console.log(`\n${C.red}No squad found for user ${MY_USER} (${YEAR}). Has the draft been completed?${C.reset}`);
    await client.close();
    return;
  }

  // Load stats
  process.stdout.write(`${C.dim}Loading stats for ${squadDocs.length} players...${C.reset}`);
  const statsMap = await loadPlayerStats(db, squadDocs.map(p => p.player_name));
  console.log(` ${C.green}done${C.reset}`);

  // Build enriched squad array
  const squad = squadDocs.map(p => {
    const s = statsMap[p.player_name];
    const scores = s ? scoreAllPositions(s.avg) : {};
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return {
      name: p.player_name,
      team: p.team,
      scores,
      statsSource: s?.source || null,
      bestPos: best?.[0] || null,
      bestScore: best?.[1] || 0,
    };
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, r));

  // ═══════════════════════════════════════════════════
  //  TEAM SELECTION
  // ═══════════════════════════════════════════════════
  if (doTeam) {
    section("YOUR SQUAD");

    const sorted = [...squad].sort((a, b) => b.bestScore - a.bestScore);
    for (const p of sorted) {
      const sev = injSeverity(p.name);
      const nc = sev >= 2 ? C.red : sev === 1 ? C.yellow : "";
      const scoreStr = p.bestScore > 0
        ? ` ${C.dim}${Math.round(p.bestScore)}pts as ${POS_SHORT[p.bestPos] || "?"}`
        : ` ${C.dim}no stats`;
      console.log(`  ${nc}${dn(p.name).padEnd(28)}${C.reset}${(p.team || "??").padEnd(5)}${scoreStr}  ${p.statsSource || ""}${C.reset}${injBadge(p.name)}`);
    }

    // Fetch AFL team selections from Footywire
    section("AFL TEAM SELECTIONS (Footywire)");
    process.stdout.write(`  ${C.dim}Fetching team selections from footywire.com...${C.reset}`);
    const fwSelections = await fetchAFLTeamSelections();
    let selectionStatus = null;

    if (!fwSelections) {
      console.log(` ${C.yellow}unavailable (teams not announced yet or site unreachable)${C.reset}`);
    } else {
      const teamsFound = Object.keys(fwSelections).length;
      console.log(` ${C.green}${teamsFound} teams loaded${C.reset}`);
      selectionStatus = buildSelectionStatus(squad, fwSelections);

      // Show selection status for each squad player
      let anyIssues = false;
      for (const p of sorted) {
        const sel = selectionStatus.get(p.name) || "unknown";
        if (sel === "playing") {
          // Only show if they have an injury flag too
          if (injSeverity(p.name) >= 1) {
            console.log(`  ${C.green}✓ NAMED   ${dn(p.name).padEnd(28)}${C.reset}${injBadge(p.name)}`);
            anyIssues = true;
          }
        } else if (sel === "emergency") {
          console.log(`  ${C.yellow}⚡ EMERG   ${dn(p.name).padEnd(28)}${C.dim}named as emergency — not confirmed${C.reset}${injBadge(p.name)}`);
          anyIssues = true;
        } else if (sel === "out") {
          console.log(`  ${C.red}✗ NOT NAMED ${dn(p.name).padEnd(26)}${C.dim}not in ${p.team}'s named 22${C.reset}${injBadge(p.name)}`);
          anyIssues = true;
        } else {
          // unknown — team not found on footywire or selections not announced yet
          if (injSeverity(p.name) >= 1) {
            console.log(`  ${C.yellow}? UNKNOWN ${dn(p.name).padEnd(27)}${injBadge(p.name)}`);
            anyIssues = true;
          }
        }
      }
      if (!anyIssues) console.log(`  ${C.green}All squad players named — no issues found.${C.reset}`);
    }

    // Auto-exclude based on injury list AND team selections
    section("AVAILABILITY SUMMARY");
    const autoExcluded = new Set();
    let hasFlags = false;

    for (const p of squad) {
      const sev = injSeverity(p.name);
      const sel = selectionStatus?.get(p.name);

      if (sev >= 3) {
        // Long-term injury — auto-exclude regardless of selection
        autoExcluded.add(p.name);
        console.log(`  ${C.red}AUTO-OUT  ${dn(p.name).padEnd(28)}${INJURIES[p.name].detail}${C.reset}`);
        hasFlags = true;
      } else if (sel === "out") {
        // Not named in team — auto-exclude
        autoExcluded.add(p.name);
        console.log(`  ${C.red}AUTO-OUT  ${dn(p.name).padEnd(28)}${C.dim}not named in ${p.team}'s team${C.reset}${injBadge(p.name)}`);
        hasFlags = true;
      } else if (sel === "emergency") {
        console.log(`  ${C.yellow}EMERGENCY ${dn(p.name).padEnd(28)}${C.dim}named emergency — may or may not play${C.reset}`);
        hasFlags = true;
      } else if (sev >= 1) {
        console.log(`  ${C.yellow}FLAGGED   ${dn(p.name).padEnd(28)}${INJURIES[p.name].detail}${C.reset}`);
        hasFlags = true;
      }
    }
    if (!hasFlags) console.log(`  ${C.green}All available — no exclusions needed.${C.reset}`);

    console.log(`\n  ${C.dim}Any extra players OUT this week? Enter last names/full names (comma-separated), or press Enter.${C.reset}`);
    const outInput = await ask(`  OUT this week: `);
    const excluded = new Set(autoExcluded);
    if (outInput.trim()) {
      for (const q of outInput.split(",").map(s => s.trim()).filter(Boolean)) {
        const match = squad.find(p =>
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          dn(p.name).toLowerCase().includes(q.toLowerCase())
        );
        if (match) { excluded.add(match.name); console.log(`  ${C.yellow}Marked OUT: ${dn(match.name)}${C.reset}`); }
        else console.log(`  ${C.red}Not found in squad: "${q}"${C.reset}`);
      }
    }

    // Calculate and show optimal lineup
    let result = findOptimalLineup(squad, excluded);
    section("OPTIMAL LINEUP");
    printLineup(result, excluded);

    // Warn about risks still in lineup
    const allInLineup = [
      ...Object.values(result.lineup), result.bench, result.reserveA, result.reserveB,
    ].filter(Boolean);
    const risks = allInLineup.filter(p => injSeverity(p.name) >= 1);
    if (risks.length > 0) {
      console.log(`\n  ${C.yellow}⚠ Risks in lineup:${C.reset}`);
      for (const p of risks) console.log(`     ${C.yellow}${dn(p.name)}: ${INJURIES[p.name]?.detail}${C.reset}`);
    }

    // Show all position scores for reference
    section("FULL SQUAD SCORE BREAKDOWN");
    console.log(`  ${"Player".padEnd(28)} ${"FF".padEnd(6)} ${"TF".padEnd(6)} ${"OFF".padEnd(6)} ${"MID".padEnd(6)} ${"TAK".padEnd(6)} ${"RUC".padEnd(6)}`);
    console.log(`  ${"-".repeat(66)}`);
    for (const p of sorted) {
      if (!p.bestScore) continue;
      const row = MAIN_POSITIONS.map(pos => String(p.scores[pos] || "—").padEnd(6)).join(" ");
      const excl = excluded.has(p.name) ? ` ${C.red}(OUT)${C.reset}` : "";
      console.log(`  ${dn(p.name).padEnd(28)} ${C.dim}${row}${C.reset}${excl}`);
    }

    // Interactive editing
    console.log(`\n  ${C.dim}Commands: Enter=accept | swap <pos> <name> | view | skip${C.reset}`);

    let teamSaved = false;
    let skipTeam = false;

    while (true) {
      const input = (await ask(`\n${C.bold}Team > ${C.reset}`)).trim();
      const lower = input.toLowerCase();

      if (!input || lower === "accept" || lower === "y" || lower === "yes") {
        // Confirm save
        if (dryRun) {
          console.log(`  ${C.yellow}Dry-run: would save team for Round ${round}${C.reset}`);
          teamSaved = true;
          break;
        }
        if (lockout?.locked) {
          const force = (await ask(`  ${C.red}Round is LOCKED. Submit anyway? (y/n): ${C.reset}`)).trim().toLowerCase();
          if (!force.startsWith("y")) { console.log(`  ${C.yellow}Team not saved.${C.reset}`); break; }
        }
        await saveTeamSelection(db, round, result);
        console.log(`  ${C.bgGreen} ✓ Team saved for Round ${round}! ${C.reset}`);
        teamSaved = true;
        break;

      } else if (lower === "skip" || lower === "q" || lower === "quit") {
        console.log(`  ${C.dim}Skipping team selection.${C.reset}`);
        skipTeam = true;
        break;

      } else if (lower === "view") {
        printLineup(result, excluded);

      } else if (lower.startsWith("swap ")) {
        // Format: swap <position-keyword> <player-name>
        // e.g. "swap ff Cameron" or "swap bench Smith"
        const parts = input.slice(5).trim().split(/\s+/);
        const posKw = parts[0].toLowerCase();
        const nameQ = parts.slice(1).join(" ").toLowerCase();

        const ALL_SLOT_NAMES = [...MAIN_POSITIONS, "Bench", "Reserve A", "Reserve B"];
        const posMatch = ALL_SLOT_NAMES.find(p =>
          p.toLowerCase().includes(posKw) ||
          (POS_SHORT[p] || "").toLowerCase() === posKw
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
          console.log(`  ${C.green}Bench: ${dn(playerMatch.name)} → backs up ${result.benchBackup}${C.reset}`);
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
  }

  // ═══════════════════════════════════════════════════
  //  TIPPING
  // ═══════════════════════════════════════════════════
  if (doTips) {
    section(`ROUND ${round} TIPPING`);

    const roundFixtures = fixtures.filter(f => f.RoundNumber === round)
      .sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));

    if (!roundFixtures.length) {
      console.log(`  ${C.red}No fixtures found for Round ${round}.${C.reset}`);
    } else {
      // Fetch odds data in parallel
      process.stdout.write(`  ${C.dim}Fetching odds...${C.reset}`);
      const [squiggleTips, sportsbetOdds] = await Promise.all([
        fetchSquiggleTips(round),
        fetchSportsbetOdds(round),
      ]);
      const oddsSource = sportsbetOdds ? "Sportsbet" : squiggleTips ? "Squiggle" : "none";
      console.log(` odds source: ${oddsSource === "none" ? C.yellow : C.green}${oddsSource}${C.reset}`);

      const suggestions = buildTipSuggestions(roundFixtures, squiggleTips, sportsbetOdds);

      section("SUGGESTED TIPS");
      console.log(`  ${"#".padEnd(5)}${"Home".padEnd(24)}${"Away".padEnd(24)}${"Tip".padEnd(24)}Odds/Conf`);
      console.log(`  ${"─".repeat(80)}`);

      for (const s of suggestions) {
        const melbDate = new Date(s.dateUtc).toLocaleString("en-AU", {
          timeZone: "Australia/Melbourne", weekday: "short", day: "numeric",
          month: "short", hour: "numeric", minute: "2-digit", hour12: true
        });
        const oddsStr = s.favOdds ? `$${Number(s.favOdds).toFixed(2)}` : `${s.confidence}%`;
        const dcFlag = s.suggestDC ? ` ${C.yellow}★ suggest DC${C.reset}` : "";
        console.log(`  ${String(s.matchNumber).padEnd(5)}${s.homeTeam.padEnd(24)}${s.awayTeam.padEnd(24)}${C.green}${s.favourite.padEnd(24)}${C.reset}${oddsStr}${dcFlag}`);
        console.log(`  ${C.dim}      ${melbDate}  (${s.source})${C.reset}`);
      }

      // Build mutable tips object (defaulting to suggestions)
      const tips = {};
      for (const s of suggestions) tips[s.matchNumber] = { team: s.favourite, deadCert: false };
      let deadCertMatch = null;

      console.log(`\n  ${C.dim}Commands: Enter=accept | tip <matchNum> <team> | dc <matchNum> | clear dc | view | skip${C.reset}`);

      while (true) {
        const input = (await ask(`\n${C.bold}Tips > ${C.reset}`)).trim();
        const lower = input.toLowerCase();

        if (!input || lower === "accept" || lower === "y" || lower === "save") {
          // Prompt for dead cert if not set
          if (!deadCertMatch) {
            const sugDC = suggestions.find(s => s.suggestDC);
            if (sugDC) {
              const dcIn = (await ask(`  ${C.yellow}No Dead Cert set. Suggest Match ${sugDC.matchNumber} — ${tips[sugDC.matchNumber].team} (${sugDC.confidence}% conf). Set as DC? (y/n): ${C.reset}`)).trim().toLowerCase();
              if (dcIn.startsWith("y")) {
                tips[sugDC.matchNumber].deadCert = true;
                deadCertMatch = sugDC.matchNumber;
              }
            }
          }

          // Show final tips
          section("TIPS TO SAVE");
          for (const s of suggestions) {
            const t = tips[s.matchNumber];
            const dcStr = t.deadCert ? ` ${C.bgYellow} ★ DEAD CERT ${C.reset}` : "";
            console.log(`  Match ${String(s.matchNumber).padEnd(4)} ${s.homeTeam.padEnd(22)} v ${s.awayTeam.padEnd(22)} → ${C.green}${t.team}${C.reset}${dcStr}`);
          }

          if (dryRun) {
            console.log(`  ${C.yellow}Dry-run: would save tips for Round ${round}${C.reset}`);
            break;
          }
          const confirm = (await ask(`\n${C.bold}Save these tips for Round ${round}? (y/n): ${C.reset}`)).trim().toLowerCase();
          if (confirm.startsWith("y")) {
            await saveTips(db, round, tips);
            console.log(`  ${C.bgGreen} ✓ Tips saved for Round ${round}! ${C.reset}`);
          } else {
            console.log(`  ${C.dim}Tips not saved.${C.reset}`);
          }
          break;

        } else if (lower === "skip" || lower === "q" || lower === "quit") {
          console.log(`  ${C.dim}Skipping tips.${C.reset}`);
          break;

        } else if (lower === "view") {
          for (const s of suggestions) {
            const t = tips[s.matchNumber];
            const dcStr = t.deadCert ? ` ${C.yellow}★ DC${C.reset}` : "";
            console.log(`  ${String(s.matchNumber).padEnd(5)}${s.homeTeam.padEnd(24)} v ${s.awayTeam.padEnd(24)} → ${C.green}${t.team}${C.reset}${dcStr}`);
          }

        } else if (lower.startsWith("tip ")) {
          const parts = input.slice(4).trim().split(/\s+/);
          const matchNum = parseInt(parts[0]);
          const teamQ = parts.slice(1).join(" ").toLowerCase();
          const fix = roundFixtures.find(f => f.MatchNumber === matchNum);
          if (!fix) { console.log(`  ${C.red}Match ${matchNum} not found.${C.reset}`); continue; }
          if (fix.HomeTeam.toLowerCase().includes(teamQ)) {
            tips[matchNum].team = fix.HomeTeam;
            console.log(`  ${C.green}Match ${matchNum} → ${fix.HomeTeam}${C.reset}`);
          } else if (fix.AwayTeam.toLowerCase().includes(teamQ)) {
            tips[matchNum].team = fix.AwayTeam;
            console.log(`  ${C.green}Match ${matchNum} → ${fix.AwayTeam}${C.reset}`);
          } else {
            console.log(`  ${C.red}Team not found in match ${matchNum}. Teams: ${fix.HomeTeam} / ${fix.AwayTeam}${C.reset}`);
          }

        } else if (lower.startsWith("dc ")) {
          const matchNum = parseInt(lower.slice(3));
          if (!tips[matchNum]) { console.log(`  ${C.red}Match ${matchNum} not found.${C.reset}`); continue; }
          if (deadCertMatch) tips[deadCertMatch].deadCert = false;
          tips[matchNum].deadCert = true;
          deadCertMatch = matchNum;
          console.log(`  ${C.yellow}★ Dead Cert → Match ${matchNum}: ${tips[matchNum].team}${C.reset}`);

        } else if (lower === "clear dc") {
          if (deadCertMatch) { tips[deadCertMatch].deadCert = false; deadCertMatch = null; }
          console.log(`  ${C.dim}Dead Cert cleared.${C.reset}`);

        } else {
          console.log(`  ${C.dim}Unknown command. Try: Enter, tip 8 carlton, dc 6, clear dc, view, skip${C.reset}`);
        }
      }
    }
  }

  await client.close();
  rl.close();
  console.log(`\n${C.dim}Done 🦆${C.reset}\n`);
}

main().catch(e => {
  console.error(`${C.red}✗ ${e.message}${C.reset}`);
  process.exit(1);
});

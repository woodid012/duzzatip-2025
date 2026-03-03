#!/usr/bin/env node
/**
 * DuzzaTip — Player Position Scores Report
 *
 * Uses 2025 season data to rank players by each fantasy position.
 * Also shows where your squad players rank, to help calibrate optimal lineup choices.
 *
 * Usage:
 *   node player-stats-report.js              — print to console + send to Telegram
 *   node player-stats-report.js --no-send    — console only
 *   node player-stats-report.js --squad-only — only show squad rankings
 */

require("dotenv").config({ path: ".env.local" });

const fs   = require("fs");
const https = require("https");
const { MongoClient } = require("mongodb");

// ===== Config =====
const MY_USER   = 4;
const YEAR      = 2025;
const MIN_GAMES = 5;    // min games for a valid average
const MIN_TOG   = 50;   // min time-on-ground %
const TOP_N     = 8;    // top N players shown per position in league list
const TELEGRAM_CHAT_ID = "8600335192";

const args = process.argv.slice(2);
const SEND       = !args.includes("--no-send");
const SQUAD_ONLY = !args.includes("--league"); // default: squad only; --league shows all players

// ===== Scoring formulas =====
const SCORE_FNS = {
  "FF":  (s) => s.goals * 9 + s.behinds,
  "TF":  (s) => s.goals * 6 + s.marks * 2,
  "OFF": (s) => s.goals * 7 + s.kicks,
  "MID": (s) => { const d = s.kicks + s.handballs; return Math.min(d, 30) + Math.max(0, d - 30) * 3; },
  "TAK": (s) => s.tackles * 4 + s.handballs,
  "RUC": (s) => {
    const t = s.hitouts + s.marks;
    if (t <= 18) return t;
    const reg = Math.max(0, 18 - s.hitouts);
    return s.hitouts + reg + (s.marks - reg) * 3;
  },
};

const POS_FULL = {
  "FF":  "Full Forward (Goals×9 + Behinds)",
  "TF":  "Tall Forward (Goals×6 + Marks×2)",
  "OFF": "Offensive   (Goals×7 + Kicks)",
  "MID": "Midfielder  (Disp≤30×1 + extra×3)",
  "TAK": "Tackler     (Tackles×4 + Handballs)",
  "RUC": "Ruck        (HO+Marks, bonus marks×3)",
};

const RESERVE_A = ["FF", "TF", "RUC"];
const RESERVE_B = ["OFF", "MID", "TAK"];

// ===== Helpers =====
function dn(name) {
  if (!name) return name;
  const parts = name.trim().split(" ");
  if (parts.length < 2) return name;
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
}

function calcAvg(games) {
  const keys = ["kicks", "handballs", "marks", "tackles", "hitouts", "goals", "behinds"];
  const avg = {};
  for (const k of keys) avg[k] = games.reduce((a, g) => a + (Number(g[k]) || 0), 0) / games.length;
  return avg;
}

function scoreAll(avg) {
  const out = {};
  for (const [pos, fn] of Object.entries(SCORE_FNS)) {
    out[pos] = Math.round(fn(avg) * 10) / 10;
  }
  return out;
}

function bestPos(scores) {
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// ===== Load 2025 stats =====
async function loadStats2025(db) {
  const byPlayer = {};

  // 1. Try MongoDB 2025_game_results
  try {
    const docs = await db.collection("2025_game_results")
      .find({ timeOnGroundPercentage: { $gte: MIN_TOG } })
      .toArray();
    if (docs.length > 0) {
      console.log(`Loaded ${docs.length} game records from MongoDB 2025_game_results`);
      for (const d of docs) {
        const name = d.player_name;
        if (!byPlayer[name]) byPlayer[name] = { name, team: d.team_name, games: [] };
        byPlayer[name].games.push(d);
      }
      return byPlayer;
    }
  } catch (_) { /* no 2025 MongoDB data */ }

  // 2. Fall back to CSV
  const csvPath = "./afl-stats-1771399552485.csv";
  if (!fs.existsSync(csvPath)) {
    throw new Error("No 2025 data found — MongoDB empty and CSV not present");
  }
  console.log("Loading 2025 stats from CSV fallback...");

  const raw = fs.readFileSync(csvPath, "utf8");
  // CSV has 3 header rows before the actual data
  const lines = raw.split("\n");
  const dataLines = lines.slice(3).join("\n");

  // Simple CSV parse (no papaparse dependency in this script)
  const rows = dataLines.split("\n");
  const headers = rows[0].split(",");
  const idx = (h) => headers.indexOf(h);

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].split(",");
    if (cols.length < 5) continue;
    const name  = cols[idx("player")]?.trim();
    const team  = cols[idx("team")]?.trim();
    const round = parseInt(cols[idx("round")]);
    const tog   = parseFloat(cols[idx("tog")]);
    if (!name || round < 1 || tog < MIN_TOG) continue;

    if (!byPlayer[name]) byPlayer[name] = { name, team, games: [] };
    byPlayer[name].games.push({
      kicks:    +cols[idx("kicks")]    || 0,
      handballs:+cols[idx("handballs")]|| 0,
      marks:    +cols[idx("marks")]    || 0,
      tackles:  +cols[idx("tackles")]  || 0,
      hitouts:  +cols[idx("hitouts")]  || 0,
      goals:    +cols[idx("goals")]    || 0,
      behinds:  +cols[idx("behinds")]  || 0,
    });
  }
  console.log(`Loaded ${Object.keys(byPlayer).length} players from CSV`);
  return byPlayer;
}

// ===== Build player list =====
function buildPlayers(byPlayer) {
  const players = [];
  for (const [, data] of Object.entries(byPlayer)) {
    if (data.games.length < MIN_GAMES) continue;
    const avg    = calcAvg(data.games);
    const scores = scoreAll(avg);
    players.push({
      name:   data.name,
      team:   data.team,
      games:  data.games.length,
      scores,
      best:   bestPos(scores),
    });
  }
  return players;
}

// ===== Load squad =====
async function loadSquad(db) {
  try {
    // Each player is a separate document: { user_id, player_name, Active, team, ... }
    const docs = await db.collection("2026_squads")
      .find({ user_id: MY_USER, Active: { $ne: 0 } })
      .toArray();
    return docs.map(d => d.player_name).filter(Boolean);
  } catch (_) {
    return [];
  }
}

// ===== Format report =====
function buildReport(players, squadNames) {
  const squadSet = new Set(squadNames.map(n => n.trim().toLowerCase()));

  const messages = [];

  // Message 1: Header + legend
  const totalPlayers = players.length;
  const hdr = [
    `🏉 DuzzaTip — 2025 Player Scores by Position`,
    `📊 ${totalPlayers} players analysed (min ${MIN_GAMES}g, TOG≥${MIN_TOG}%)`,
    `Data source: 2025 AFL season`,
    ``,
    `Scoring formulas:`,
    `  FF  = Goals×9 + Behinds`,
    `  TF  = Goals×6 + Marks×2`,
    `  OFF = Goals×7 + Kicks`,
    `  MID = Disp≤30 pts each, extra×3`,
    `  TAK = Tackles×4 + Handballs`,
    `  RUC = HO+Marks (marks bonus×3 over 18)`,
    ``,
    `Reserve A covers: FF/TF/RUC`,
    `Reserve B covers: OFF/MID/TAK`,
  ];
  messages.push(hdr.join("\n"));

  // One message per 2 positions (keeps under Telegram 4096 limit)
  const posGroups = [
    ["FF", "TF"],
    ["OFF", "MID"],
    ["TAK", "RUC"],
  ];

  for (const group of posGroups) {
    const lines = [];
    for (const pos of group) {
      const sorted = [...players].sort((a, b) => b.scores[pos] - a.scores[pos]);
      const leagueAvg = (sorted.reduce((a, p) => a + p.scores[pos], 0) / sorted.length).toFixed(1);
      const p75 = sorted[Math.floor(sorted.length * 0.25)]?.scores[pos].toFixed(1) ?? "?";

      lines.push(`── ${pos}: ${POS_FULL[pos]} ──`);
      lines.push(`League avg: ${leagueAvg} | Top 25%: ${p75}+`);

      if (!SQUAD_ONLY) {
        lines.push(`Top ${TOP_N} overall:`);
        sorted.slice(0, TOP_N).forEach((p, i) => {
          const squadFlag = squadSet.has(p.name.toLowerCase()) ? " ⭐" : "";
          lines.push(`  ${String(i+1).padStart(2)}. ${p.scores[pos].toFixed(1).padStart(5)}  ${dn(p.name)} (${p.team})${squadFlag}`);
        });
      }

      // Squad players at this position
      const squadAtPos = sorted.filter(p => squadSet.has(p.name.toLowerCase()));
      if (squadAtPos.length > 0) {
        lines.push(`Your squad (ranked #):`);
        for (const p of squadAtPos) {
          const rank = sorted.findIndex(x => x.name === p.name) + 1;
          const pct  = Math.round((1 - rank / sorted.length) * 100);
          const bestFlag = p.best === pos ? " ← BEST POS" : "";
          lines.push(`  #${rank}/${sorted.length}  ${p.scores[pos].toFixed(1).padStart(5)}  ${dn(p.name)} (${p.team}) top ${100-pct}%${bestFlag}`);
        }
      } else {
        lines.push(`Your squad: (no players with 2025 data at this pos)`);
      }
      lines.push("");
    }
    messages.push(lines.join("\n").trim());
  }

  // Final message: squad summary — best position for each squad player
  if (squadNames.length > 0) {
    const squadPlayers = players.filter(p => squadSet.has(p.name.toLowerCase()));
    const summaryLines = [
      `── 🦆⚡ Your Squad — Best Position Summary ──`,
      `Player                    Best  Score  2nd Best`,
      `─────────────────────────────────────────────`,
    ];
    squadPlayers
      .sort((a, b) => b.scores[b.best] - a.scores[a.best])
      .forEach(p => {
        const sorted = Object.entries(p.scores).sort((a, b) => b[1] - a[1]);
        const [bp, bs] = sorted[0];
        const [sp, ss] = sorted[1] ?? ["—", 0];
        summaryLines.push(
          `${dn(p.name).padEnd(26)} ${bp.padEnd(4)} ${String(bs.toFixed(1)).padStart(5)}  ${sp}: ${ss.toFixed(1)}`
        );
      });

    // Suggest optimal positions
    summaryLines.push("");
    summaryLines.push("💡 Optimal lineup algorithm:");
    summaryLines.push("Greedy max-margin — assigns the position where your top");
    summaryLines.push("player has the biggest edge over the next-best squad member.");
    summaryLines.push("Reserve A covers FF/TF/RUC — pick your best FF/TF/RUC backup.");
    summaryLines.push("Reserve B covers OFF/MID/TAK — pick your best OFF/MID/TAK backup.");

    messages.push(summaryLines.join("\n"));
  }

  return messages;
}

// ===== Telegram =====
async function sendTelegram(text, dryRun = false) {
  if (dryRun) { console.log("[DRY] Would send:", text.slice(0, 100), "..."); return; }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn("No TELEGRAM_BOT_TOKEN — skipping send"); return; }

  const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${token}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        const r = JSON.parse(data);
        if (!r.ok) console.error("Telegram error:", r.description);
        resolve(r);
      });
    });
    req.on("error", (e) => { console.error("Telegram request error:", e); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ===== Main =====
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("afl_database");

  console.log("Loading 2025 player stats...");
  const byPlayer = await loadStats2025(db);
  const players  = buildPlayers(byPlayer);
  console.log(`Built scores for ${players.length} players`);

  console.log("Loading squad...");
  const squadNames = await loadSquad(db);
  console.log(`Squad: ${squadNames.length} players`);

  await client.close();

  const messages = buildReport(players, squadNames);

  // Print to console
  for (const msg of messages) {
    console.log("\n" + "═".repeat(64));
    console.log(msg);
  }

  // Send to Telegram
  if (SEND) {
    console.log(`\nSending ${messages.length} messages to Telegram...`);
    for (let i = 0; i < messages.length; i++) {
      await sendTelegram(messages[i]);
      // Small delay between messages
      if (i < messages.length - 1) await new Promise(r => setTimeout(r, 600));
    }
    console.log("Done.");
  }
}

main().catch(err => { console.error(err); process.exit(1); });

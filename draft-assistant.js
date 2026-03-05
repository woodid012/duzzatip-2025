#!/usr/bin/env node
/**
 * DuzzaTip 2026 Live Draft Assistant
 * Run: node draft-assistant.js
 *
 * - Reads live draft state from MongoDB (2026_draft_picks)
 * - Polls for opponent picks automatically — no manual entry needed
 * - Shows your current team from DB
 * - Suggests 3 players on your turn, writes your pick to DB
 */

require("dotenv").config({ path: ".env.local" });

const fs = require("fs");
const Papa = require("papaparse");
const readline = require("readline");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { INJURIES, INJURY_DISPLAY } = require("./injuries-2026");

const MY_USER = 4;
const DRAFT_ORDER = [6, 4, 7, 8, 1, 3, 2, 5];
const USER_NAMES = {
  1: "flailing feathers",
  2: "Garvs Garden Gnomes",
  3: "Miguel's Marauders",
  4: "Le Mallards",
  5: "Rands Ruffians",
  6: "Balls Deep Briz",
  7: "Honour String",
  8: "pinga jinga jim",
};
const TOTAL_PICKS = 144;
const COLLECTION = "2026_draft_picks";
const POLL_INTERVAL_MS = 3000;

// ===== Scoring =====
const POSITIONS = {
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
  }
};
const POS_LIST = Object.keys(POSITIONS);
const POS_SHORT = { "Full Forward": "FF", "Midfielder": "MID", "Offensive": "OFF", "Tall Forward": "TF", "Tackler": "TAK", "Ruck": "RUC" };
const POS_CAPS = { "Full Forward": 3, "Midfielder": 4, "Offensive": 3, "Tall Forward": 3, "Tackler": 4, "Ruck": 3 };

// ===== Build pick order =====
function buildAllPicks() {
  const picks = [];
  for (let round = 1; round <= 18; round++) {
    const order = round % 2 === 1 ? [...DRAFT_ORDER] : [...DRAFT_ORDER].reverse();
    order.forEach(userId => picks.push({ pick: picks.length + 1, round, userId }));
  }
  return picks;
}
const ALL_PICKS = buildAllPicks();
const MY_PICK_NUMS = ALL_PICKS.filter(p => p.userId === MY_USER).map(p => p.pick);

// ===== Build player database =====
function buildPlayerDB() {
  const csvRaw = fs.readFileSync("./afl-stats-1771399552485.csv", "utf8");
  const parsed = Papa.parse(csvRaw.split("\n").slice(3).join("\n"), { header: true, skipEmptyLines: true });
  const playerGames2025 = {};
  for (const row of parsed.data) {
    if (!row.player || !row.team) continue;
    const name = row.player.trim();
    const round = parseInt(row.round);
    const tog = parseFloat(row.tog) || 0;
    if (round < 1 || tog < 50) continue;
    if (!playerGames2025[name]) playerGames2025[name] = { team: row.team.trim(), games: [] };
    playerGames2025[name].games.push({
      kicks: parseInt(row.kicks)||0, handballs: parseInt(row.handballs)||0,
      marks: parseInt(row.marks)||0, tackles: parseInt(row.tackles)||0,
      hitouts: parseInt(row.hitouts)||0, goals: parseInt(row.goals)||0, behinds: parseInt(row.behinds)||0,
    });
  }

  const csv2024Raw = fs.readFileSync("./afltables-2024.csv", "utf8");
  const parsed2024 = Papa.parse(csv2024Raw, { header: true, skipEmptyLines: true });
  const playerStats2024 = {};
  for (const row of parsed2024.data) {
    if (!row.player) continue;
    const name = row.player.trim();
    const games = parseInt(row.games) || 0;
    if (games < 1) continue;
    playerStats2024[name] = {
      games,
      kicks:    (parseInt(row.kicks)||0) / games,
      handballs:(parseInt(row.handballs)||0) / games,
      marks:    (parseInt(row.marks)||0) / games,
      tackles:  (parseInt(row.tackles)||0) / games,
      hitouts:  (parseInt(row.hitouts)||0) / games,
      goals:    (parseInt(row.goals)||0) / games,
      behinds:  (parseInt(row.behinds)||0) / games,
    };
  }

  const p2026 = Papa.parse(fs.readFileSync("./python/upload_list_2026.csv", "utf8"), { header: true, skipEmptyLines: true });
  const available2026 = new Map();
  for (const row of p2026.data) if (row.player && row.team) available2026.set(row.player.trim(), row.team.trim());

  const players = [];
  const allNames = new Set([...Object.keys(playerGames2025), ...Object.keys(playerStats2024)]);
  for (const name of allNames) {
    const team2026 = available2026.get(name);
    if (!team2026) continue;
    const data2025 = playerGames2025[name];
    const data2024 = playerStats2024[name];
    const n2025 = data2025 ? data2025.games.length : 0;
    const n2024 = data2024 ? data2024.games : 0;
    if (n2025 < 3 && n2024 < 3) continue;

    let avg2025 = null;
    if (n2025 >= 3) {
      avg2025 = {};
      for (const k of ["kicks","handballs","marks","tackles","hitouts","goals","behinds"])
        avg2025[k] = data2025.games.reduce((a,g) => a + g[k], 0) / n2025;
    }

    let w2025, w2024;
    if (avg2025 && data2024) { w2025 = (n2025 < 10 && n2024 > 10) ? 0.4 : 0.6; w2024 = 1 - w2025; }
    else if (avg2025) { w2025 = 1.0; w2024 = 0.0; }
    else { w2025 = 0.0; w2024 = 1.0; }

    const blended = {};
    for (const k of ["kicks","handballs","marks","tackles","hitouts","goals","behinds"])
      blended[k] = (avg2025 ? avg2025[k] : 0) * w2025 + (data2024 ? data2024[k] : 0) * w2024;

    const posScores = {};
    let bestPos = "", bestAvg = 0;
    for (const [posName, formula] of Object.entries(POSITIONS)) {
      const avg = formula(blended);
      posScores[posName] = Math.round(avg * 10) / 10;
      if (avg > bestAvg) { bestAvg = avg; bestPos = posName; }
    }

    let flag = "";
    if (avg2025 && data2024 && n2025 >= 5 && n2024 >= 5) {
      const best2024 = Math.max(...Object.values(POSITIONS).map(f => f(data2024)));
      const best2025 = Math.max(...Object.values(POSITIONS).map(f => f(avg2025)));
      if (best2024 > best2025 * 1.25 && best2024 > 20) flag = "BOUNCE BACK";
      else if (best2025 > best2024 * 1.25 && n2025 < 15) flag = "INJURY RISK";
    }

    // Per-year scores at best position (for display)
    const posScores2025 = {};
    const posScores2024 = {};
    for (const [posName, formula] of Object.entries(POSITIONS)) {
      posScores2025[posName] = avg2025 ? Math.round(formula(avg2025) * 10) / 10 : null;
      posScores2024[posName] = data2024 ? Math.round(formula(data2024) * 10) / 10 : null;
    }

    players.push({
      name, team: team2026, games2025: n2025, games2024: n2024,
      posScores, posScores2025, posScores2024,
      bestPos, bestAvg: Math.round(bestAvg * 10) / 10,
      compositeValue: Math.max(...Object.values(posScores)),
      flag,
      blend: w2025 > 0 && w2024 > 0 ? `${w2025*100|0}/${w2024*100|0}` : (w2025 > 0 ? "2025 only" : "2024 only"),
    });
  }
  return players;
}

// ===== 2026 Bye rounds (rounds 12-16) =====
const BYE_ROUNDS = {
  ADE: 12, GCS: 12, NTH: 12, PTA: 12,
  GWS: 13, RIC: 13,
  CAR: 14, COL: 14, FRE: 14, HAW: 14,
  BRL: 15, ESS: 15, SYD: 15, WCE: 15,
  GEE: 16, MEL: 16, STK: 16, WBD: 16,
};

function getByeRound(team) { return BYE_ROUNDS[team] || null; }

// Count how many players on myTeam share each bye round
function byeRoundCounts(myTeam) {
  const counts = {};
  for (const p of myTeam) {
    const bye = getByeRound(p.team);
    if (bye) counts[bye] = (counts[bye] || 0) + 1;
  }
  return counts;
}

// ===== Suggest top 3 for my team =====
function suggestPicks(available, myPosCounts, pickIndex, myTeam) {
  const candidates = [];
  for (const player of available) {
    for (const posName of POS_LIST) {
      if (myPosCounts[posName] >= POS_CAPS[posName]) continue;
      const rawScore = player.posScores[posName];
      if (rawScore < 5) continue;
      const unfilledPositions = POS_LIST.filter(p => myPosCounts[p] === 0);
      const isUnfilled = unfilledPositions.includes(posName);
      const currentCount = myPosCounts[posName];
      let value;
      if (pickIndex < 6) {
        value = isUnfilled ? rawScore * 3 : currentCount === 1 ? rawScore * 0.5 : rawScore * 0.1;
      } else if (pickIndex < 9) {
        value = isUnfilled ? rawScore * 4 : currentCount === 1 ? rawScore * 1.5 : rawScore * 0.2;
      } else if (pickIndex < 14) {
        value = isUnfilled ? rawScore * 5 : currentCount === 1 ? rawScore * 2 : currentCount === 2 ? rawScore * 1 : rawScore * 0.3;
      } else {
        value = currentCount < 2 ? rawScore * 2 : rawScore * 0.8;
      }
      const versatile = POS_LIST.filter(p => player.posScores[p] > (p === "Ruck" ? 20 : p === "Tackler" ? 25 : 15)).length;
      if (versatile >= 2) value *= 1.1;
      if (versatile >= 3) value *= 1.15;
      candidates.push({ player, pos: posName, rawScore, value, isUnfilled });
    }
  }
  const seen = new Set();
  return candidates
    .sort((a, b) => b.value - a.value)
    .filter(c => { if (seen.has(c.player.name)) return false; seen.add(c.player.name); return true; })
    .slice(0, 3);
}

function buildReason(s, myPosCounts, myTeam) {
  const { player, pos, rawScore } = s;
  const parts = [];
  const currentCount = myPosCounts[pos];
  parts.push(currentCount === 0 ? `fills EMPTY ${pos} slot` : `${POS_SHORT[pos]} depth (${currentCount}/${POS_CAPS[pos]})`);
  parts.push(`${rawScore} pts/game as ${POS_SHORT[pos]}`);
  const versatile = POS_LIST.filter(p => player.posScores[p] > (p === "Ruck" ? 20 : p === "Tackler" ? 25 : 15));
  if (versatile.length >= 2) parts.push(`versatile: also ${versatile.filter(p=>p!==pos).map(p=>POS_SHORT[p]).join("/")} capable`);
  if (player.flag) parts.push(player.flag);
  if (player.games2025 >= 15) parts.push(`${player.games2025}g 2025 data`);
  // Bye round info
  const playerBye = getByeRound(player.team);
  if (playerBye) {
    const stack = myTeam ? byeRoundCounts(myTeam)[playerBye] || 0 : 0;
    if (stack >= 2) parts.push(`⚠ BYE R${playerBye} clash (${stack} already)`);
    else parts.push(`bye R${playerBye}`);
  }
  return parts.join("  |  ");
}

// ===== Bye filler suggestions (final 5 picks) =====
function suggestByeFillers(available, myTeam, myPosCounts) {
  const byeCounts = byeRoundCounts(myTeam);
  // Find bye rounds with fewer than 2 players (thin coverage)
  const thinRounds = [12, 13, 14, 15, 16].filter(r => (byeCounts[r] || 0) < 2);
  if (thinRounds.length === 0) return null;

  const fillers = [];
  for (const r of thinRounds) {
    // Best available player NOT in this bye round (i.e. they PLAY in round r)
    const candidates = available
      .filter(p => getByeRound(p.team) !== r)
      .filter(p => POS_LIST.some(pos => myPosCounts[pos] < POS_CAPS[pos]))
      .sort((a, b) => b.compositeValue - a.compositeValue)
      .slice(0, 1);
    if (candidates.length > 0) {
      fillers.push({ round: r, have: byeCounts[r] || 0, player: candidates[0] });
    }
  }
  return fillers.length > 0 ? { thinRounds, fillers } : null;
}

// Display name as "Surname, Firstname" — search/DB still use original
function dn(fullName) {
  if (!fullName) return fullName;
  const parts = fullName.trim().split(" ");
  if (parts.length < 2) return fullName;
  const surname = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(" ");
  return `${surname}, ${first}`;
}

function findPlayer(name, players) {
  const lower = name.toLowerCase().trim();
  const exact = players.find(p => p.name.toLowerCase() === lower);
  if (exact) return exact;
  const partial = players.filter(p => p.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) return partial;
  return null;
}

// ===== Display =====
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", bgGreen: "\x1b[42m",
};

function header(text) {
  console.log(`\n${C.bold}${C.cyan}${"=".repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${"=".repeat(60)}${C.reset}`);
}
function section(text) { console.log(`\n${C.bold}${C.yellow}--- ${text} ---${C.reset}`); }

function printTeam(myTeam, myPosCounts) {
  section("YOUR TEAM");
  if (myTeam.length === 0) { console.log(`${C.dim}  (no picks yet)${C.reset}`); return; }
  for (const posName of POS_LIST) {
    const players = myTeam.filter(p => p.draftedAs === posName);
    const cap = POS_CAPS[posName];
    const over = Math.max(0, players.length - cap);
    const bar = `[${"#".repeat(Math.min(players.length, cap))}${over > 0 ? `+${over}` : ".".repeat(cap - players.length)}]`;
    const names = players.map(p => dn(p.name)).join(", ") || "-";
    console.log(`  ${POS_SHORT[posName].padEnd(4)} ${bar} ${names}`);
  }
  // Bye round spread
  const byeCounts = byeRoundCounts(myTeam);
  if (Object.keys(byeCounts).length > 0) {
    const byeStr = [12, 13, 14, 15, 16].map(r => {
      const count = byeCounts[r] || 0;
      const teams = myTeam.filter(p => getByeRound(p.team) === r).map(p => p.team);
      const color = count >= 3 ? C.red : count === 2 ? C.yellow : C.dim;
      return `${color}R${r}:${count}${C.reset}`;
    }).join("  ");
    console.log(`\n  ${C.dim}Bye spread:${C.reset}  ${byeStr}`);
    const maxBye = Math.max(...Object.values(byeCounts));
    if (maxBye >= 3) console.log(`  ${C.red}⚠ ${maxBye} players share a bye round — avoid adding more from that group${C.reset}`);
    else if (maxBye === 2) console.log(`  ${C.yellow}⚠ 2 players share a bye round — consider spreading in later picks${C.reset}`);
  }
}

function printSuggestions(suggestions, myPosCounts, myTeam) {
  section("SUGGESTIONS FOR YOUR PICK");
  suggestions.forEach((s, i) => {
    const flagStr = s.player.flag ? ` ${C.yellow}[${s.player.flag}]${C.reset}` : "";
    const inj = INJURIES[s.player.name];
    const injStr = inj ? ` ${INJURY_DISPLAY[inj.status].color}[? ${INJURY_DISPLAY[inj.status].label}: ${inj.detail}]${C.reset}` : "";
    const score2025 = s.player.posScores2025[s.pos];
    const score2024 = s.player.posScores2024[s.pos];
    const yearStr = [
      score2025 != null ? `${C.green}2025: ${score2025}${C.dim} (${s.player.games2025}g)` : `${C.dim}2025: n/a`,
      score2024 != null ? `2024: ${score2024} (${s.player.games2024}g)` : `2024: n/a`,
    ].join(`  `);
    console.log(`\n  ${C.bold}${C.green}[${i + 1}] ${dn(s.player.name)}${C.reset} (${s.player.team})${flagStr}${injStr}`);
    console.log(`      ${C.bold}${s.pos}${C.reset}  |  blended: ${C.bold}${s.rawScore}${C.reset}  [${yearStr}${C.reset}]`);
    console.log(`      ${C.dim}${buildReason(s, myPosCounts, myTeam)}${C.reset}`);
    const allScores = POS_LIST.map(p => `${POS_SHORT[p]}:${s.player.posScores[p]}`).join("  ");
    console.log(`      ${C.dim}${allScores}${C.reset}`);
  });
}

// ===== MongoDB helpers =====
async function fetchDraftState(collection) {
  const picks = await collection.find({ Active: 1 }).sort({ pick_number: 1 }).toArray();
  return picks;
}

async function submitPick(collection, pickNumber, round, userId, playerName, teamName, position) {
  await collection.insertOne({
    pick_number: pickNumber,
    round,
    user_id: userId,
    player_name: playerName,
    team_name: teamName,
    position,
    timestamp: new Date(),
    Active: 1,
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Optimally assign positions across a set of players, respecting POS_CAPS
function optimizeAllPositions(pickedPlayers) {
  const assignments = new Map();
  const counts = {};
  POS_LIST.forEach(p => counts[p] = 0);

  for (let pass = 0; pass < 8; pass++) {
    for (const player of pickedPlayers) {
      if (assignments.has(player.name)) continue;
      const available = POS_LIST.filter(pos => counts[pos] < POS_CAPS[pos]);
      if (!available.length) continue;
      const sorted = [...available].sort((a, b) => (player.posScores?.[b] || 0) - (player.posScores?.[a] || 0));
      const unfilled = sorted.filter(pos => counts[pos] === 0);
      const target = unfilled.length > 0 ? unfilled[0] : sorted[0];
      if (pass < 3) {
        const otherUnfilled = POS_LIST.filter(pos => counts[pos] === 0 && pos !== target);
        const betterElsewhere = otherUnfilled.some(pos => (player.posScores?.[pos] || 0) > (player.posScores?.[target] || 0));
        if (betterElsewhere) continue;
      }
      assignments.set(player.name, target);
      counts[target]++;
    }
  }
  // Fallback for any still-unassigned
  for (const player of pickedPlayers) {
    if (!assignments.has(player.name)) {
      const fallback = POS_LIST.find(pos => counts[pos] < POS_CAPS[pos]);
      if (fallback) { assignments.set(player.name, fallback); counts[fallback]++; }
    }
  }
  return { assignments, counts };
}

// ===== Shared pick loop (used by both live and mock modes) =====
async function runDraft({ allPlayers, picks, drafted, myTeam, myPosCounts, ask, submitPickFn, opponentPickFn, teamDrafted }) {
  let myPickIndex = myTeam.length;

  // Initialise teamDrafted from already-known picks (resume case)
  if (!teamDrafted) teamDrafted = {};
  DRAFT_ORDER.forEach(id => { if (!teamDrafted[id]) teamDrafted[id] = []; });

  for (const pickInfo of picks) {
    const available = allPlayers.filter(p => !drafted.has(p.name));

    if (pickInfo.userId !== MY_USER) {
      // ===== OPPONENT PICK =====
      const top3predicted = [...available].sort((a, b) => b.compositeValue - a.compositeValue).slice(0, 3);
      const predicted = top3predicted[0];

      // Show prediction + targeting watchlist BEFORE waiting for the pick
      const predStr = top3predicted.length
        ? top3predicted.map((p, i) => `${i === 0 ? C.cyan : C.dim}${i + 1}. ${dn(p.name)} (${p.bestPos}, ${p.bestAvg})${C.reset}`).join(`${C.dim}  `)
        : "";
      process.stdout.write(`\n${C.dim}Pick ${pickInfo.pick} (Rd ${pickInfo.round}) - ${USER_NAMES[pickInfo.userId]}${C.reset}\n`);
      process.stdout.write(`  ${C.dim}predicted: ${predStr}${C.reset}\n`);
      const nextMyPick = picks.find(p => p.userId === MY_USER && p.pick > pickInfo.pick);
      if (nextMyPick) {
        const picksUntilMe = picks.filter(p => p.userId !== MY_USER && p.pick > pickInfo.pick && p.pick < nextMyPick.pick).length;
        const nowAvailable = allPlayers.filter(p => !drafted.has(p.name));
        const watchlist = suggestPicks(nowAvailable, myPosCounts, myPickIndex, myTeam).slice(0, 3);
        if (watchlist.length > 0) {
          process.stdout.write(`  ${C.dim}↳ my pick in ${picksUntilMe} | targeting: ${watchlist.map(s => `${C.bold}${dn(s.player.name)}${C.reset}${C.dim} (${s.rawScore})`).join(", ")}${C.reset}\n`);
        }
      }

      const picked = await opponentPickFn(pickInfo, predicted, available);
      drafted.add(picked.name);
      teamDrafted[pickInfo.userId].push(picked.name);
      const pickedData = allPlayers.find(p => p.name === picked.name);
      const scoreStr = pickedData ? ` ${C.bold}${pickedData.bestAvg}${C.reset}${pickedData.bestPos ? ` ${pickedData.bestPos}` : ""}` : "";
      const hitIdx = top3predicted.findIndex(p => p.name === picked.name);
      const hit = hitIdx === 0;
      const resultColor = hitIdx >= 0 ? C.green : C.dim;
      const callStr = hit ? ` ✓ called it` : hitIdx > 0 ? ` ✓ (#${hitIdx + 1} predicted)` : (predicted ? ` (predicted: ${dn(predicted.name)})` : "");
      process.stdout.write(`${resultColor}  → ${C.bold}${dn(picked.name)}${C.reset}${resultColor} (${picked.team})${scoreStr}${resultColor}${callStr}${C.reset}\n`);

    } else {
      // ===== MY TURN =====
      header(`YOUR TURN - Pick #${pickInfo.pick} (Round ${pickInfo.round})`);
      printTeam(myTeam, myPosCounts);

      const suggestions = suggestPicks(available, myPosCounts, myPickIndex, myTeam);
      printSuggestions(suggestions, myPosCounts, myTeam);

      // Bye filler callout — final 5 picks (rounds 14-18)
      if (myPickIndex >= 13) {
        const byeInfo = suggestByeFillers(available, myTeam, myPosCounts);
        if (byeInfo) {
          console.log(`\n  ${C.bold}${C.yellow}--- BYE FILLERS (thin coverage detected) ---${C.reset}`);
          const byeCounts = byeRoundCounts(myTeam);
          for (const r of [12, 13, 14, 15, 16]) {
            const count = byeCounts[r] || 0;
            const color = count === 0 ? C.red : count === 1 ? C.yellow : C.dim;
            const teams = myTeam.filter(p => getByeRound(p.team) === r).map(p => dn(p.name)).join(", ") || "none";
            console.log(`  ${color}  R${r}: ${count} player(s) — ${teams}${C.reset}`);
          }
          console.log();
          for (const f of byeInfo.fillers) {
            const inj = INJURIES[f.player.name];
            const injStr = inj ? ` ${INJURY_DISPLAY[inj.status].color}[${INJURY_DISPLAY[inj.status].label}]${C.reset}` : "";
            console.log(`  ${C.yellow}Fill R${f.round} gap (${f.have}/2):${C.reset} ${C.bold}${dn(f.player.name)}${C.reset} (${f.player.team} — bye R${getByeRound(f.player.team)}) ${f.player.bestAvg} pts${injStr}`);
          }
        }
      }

      const unfilled = POS_LIST.filter(p => myPosCounts[p] === 0);
      if (unfilled.length > 0) console.log(`\n  ${C.yellow}Still need: ${unfilled.join(", ")}${C.reset}`);

      let picked = false;
      while (!picked) {
        const input = await ask(`\n${C.bold}Your pick (1/2/3, player name, "search <name>", "top", "team", "board"): ${C.reset}`);
        const trimmed = input.trim();

        if (trimmed === "1" || trimmed === "2" || trimmed === "3") {
          const s = suggestions[parseInt(trimmed) - 1];
          if (s) {
            const posOptions = POS_LIST.filter(p => myPosCounts[p] < POS_CAPS[p]);
            console.log(`\n  ${C.cyan}${dn(s.player.name)} - available slots: ${posOptions.map(p => `${POS_SHORT[p]}:${s.player.posScores[p]}`).join("  ")}${C.reset}`);
            const posInput = await ask(`  Draft as position (default: ${s.pos}): `);
            let finalPos = s.pos;
            if (posInput.trim()) {
              const matched = POS_LIST.find(p => p.toLowerCase().includes(posInput.trim().toLowerCase()) || POS_SHORT[p].toLowerCase() === posInput.trim().toLowerCase());
              if (matched && myPosCounts[matched] < POS_CAPS[matched]) finalPos = matched;
              else console.log(`  ${C.red}Invalid/full, using ${s.pos}${C.reset}`);
            }
            await submitPickFn(pickInfo, s.player, finalPos);
            drafted.add(s.player.name);
            teamDrafted[MY_USER].push(s.player.name);
            myTeam.push({ ...s.player, draftedAs: finalPos });
            myPosCounts[finalPos]++;
            myPickIndex++;
            console.log(`  ${C.bgGreen}${C.bold} DRAFTED: ${dn(s.player.name)} as ${finalPos} (${s.rawScore} pts/game) ${C.reset}`);
            picked = true;
          }

        } else if (trimmed.toLowerCase().startsWith("search ")) {
          const query = trimmed.slice(7);
          const results = available.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
          if (results.length === 0) console.log(`  ${C.red}No players found${C.reset}`);
          else results.forEach(p => console.log(`  ${dn(p.name).padEnd(26)} ${p.team.padEnd(4)} ${p.bestPos.padEnd(14)} ${p.bestAvg} pts${p.flag ? " ["+p.flag+"]" : ""}`));

        } else if (trimmed.toLowerCase() === "top") {
          const top10 = [...available].sort((a,b) => b.compositeValue - a.compositeValue).slice(0, 10);
          section("TOP 10 AVAILABLE");
          top10.forEach((p, i) => console.log(`  ${i+1}. ${dn(p.name).padEnd(26)} ${p.team.padEnd(4)} ${p.bestPos.padEnd(14)} ${p.bestAvg}`));

        } else if (trimmed.toLowerCase() === "team") {
          printTeam(myTeam, myPosCounts);

        } else if (trimmed.toLowerCase() === "board") {
          section("ALL TEAMS");
          for (const userId of DRAFT_ORDER) {
            const picks = teamDrafted[userId] || [];
            const name = USER_NAMES[userId];
            const tag = userId === MY_USER ? `${C.bold}${C.green}(YOU)${C.reset} ` : "";
            console.log(`\n  ${C.bold}${name}${C.reset} ${tag}— ${picks.length} picks`);
            if (picks.length === 0) { console.log(`    ${C.dim}(none yet)${C.reset}`); continue; }
            picks.forEach((pName, i) => {
              const pData = allPlayers.find(p => p.name === pName);
              const score = pData ? ` ${pData.bestAvg} ${POS_SHORT[pData.bestPos]}` : "";
              const inj = INJURIES[pName];
              const injStr = inj ? ` ${INJURY_DISPLAY[inj.status].color}[${INJURY_DISPLAY[inj.status].label}]${C.reset}` : "";
              console.log(`    ${String(i+1).padStart(2)}. ${dn(pName)}${C.dim}${score}${C.reset}${injStr}`);
            });
          }

        } else if (trimmed) {
          const found = findPlayer(trimmed, available);
          if (!found) { console.log(`  ${C.red}Not found or already drafted: "${trimmed}"${C.reset}`); }
          else if (Array.isArray(found)) { console.log(`  ${C.yellow}Multiple matches: ${found.map(p=>dn(p.name)).join(", ")}${C.reset}`); }
          else {
            const posOptions = POS_LIST.filter(p => myPosCounts[p] < POS_CAPS[p]);
            console.log(`\n  ${C.cyan}${dn(found.name)} - ${found.team} | ${posOptions.map(p => `${POS_SHORT[p]}:${found.posScores[p]}`).join("  ")}${C.reset}`);
            const posInput = await ask(`  Draft as position: `);
            const matched = POS_LIST.find(p => p.toLowerCase().includes(posInput.trim().toLowerCase()) || POS_SHORT[p].toLowerCase() === posInput.trim().toLowerCase());
            if (matched && myPosCounts[matched] < POS_CAPS[matched]) {
              await submitPickFn(pickInfo, found, matched);
              drafted.add(found.name);
              teamDrafted[MY_USER].push(found.name);
              myTeam.push({ ...found, draftedAs: matched });
              myPosCounts[matched]++;
              myPickIndex++;
              console.log(`  ${C.bgGreen}${C.bold} DRAFTED: ${dn(found.name)} as ${matched} (${found.posScores[matched]} pts/game) ${C.reset}`);
              picked = true;
            } else {
              console.log(`  ${C.red}Invalid or full position${C.reset}`);
            }
          }
        }
      }
    }
  }
}

// ===== Final summary (shared) =====
function printFinalSummary(myTeam) {
  header("DRAFT COMPLETE - YOUR TEAM");
  const myPosCounts = {};
  POS_LIST.forEach(p => myPosCounts[p] = 0);
  myTeam.forEach(p => myPosCounts[p.draftedAs]++);
  printTeam(myTeam, myPosCounts);

  section("OPTIMAL STARTING LINEUP");
  const lineupUsed = new Set();
  const lineup = {};
  for (let pass = 0; pass < 6; pass++) {
    for (const posName of POS_LIST) {
      if (lineup[posName]) continue;
      const candidates = myTeam.filter(p => !lineupUsed.has(p.name) && p.posScores).sort((a, b) => b.posScores[posName] - a.posScores[posName]);
      if (candidates.length > 0) {
        const cand = candidates[0];
        const otherUnfilled = POS_LIST.filter(p => p !== posName && !lineup[p]);
        const betterElsewhere = otherUnfilled.some(p => cand.posScores[p] > cand.posScores[posName]);
        if (!betterElsewhere || pass >= 3) { lineup[posName] = cand; lineupUsed.add(cand.name); }
      }
    }
  }
  let total = 0;
  for (const posName of POS_LIST) {
    const p = lineup[posName];
    if (p) {
      const score = p.posScores[posName];
      total += score;
      const inj = INJURIES[p.name];
      const injStr = inj ? ` ${INJURY_DISPLAY[inj.status].color}[${INJURY_DISPLAY[inj.status].label}]${C.reset}` : "";
      console.log(`  ${posName.padEnd(14)} ${dn(p.name).padEnd(25)} ${score} pts/game${injStr}`);
    }
  }
  const bench = myTeam.filter(p => !lineupUsed.has(p.name));
  ["Bench","Reserve A","Reserve B"].forEach((label, i) => {
    if (bench[i]) console.log(`  ${label.padEnd(14)} ${dn(bench[i].name)}`);
  });
  console.log(`\n  ${C.bold}Projected weekly score: ~${Math.round(total)} pts${C.reset}`);
}

// ===== Main =====
async function main() {
  const isMock = process.argv.includes("--mock");

  header(isMock ? "DuzzaTip 2026 Mock Draft" : "DuzzaTip 2026 Live Draft Assistant");
  console.log(`${C.dim}Loading player database...${C.reset}`);

  const allPlayers = buildPlayerDB();
  console.log(`${C.green}Loaded ${allPlayers.length} players | Your picks: ${MY_PICK_NUMS.join(", ")}${C.reset}`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  const drafted = new Set();
  const myTeam = [];
  const myPosCounts = {};
  POS_LIST.forEach(p => myPosCounts[p] = 0);

  // ===== Track opponent pick numbers to skip already-drafted =====
  let processedPicks = 0;

  if (isMock) {
    // ===== MOCK MODE — no DB, instant opponent picks =====
    console.log(`${C.yellow}MOCK MODE — opponents auto-pick best available, nothing saved to DB${C.reset}\n`);

    await runDraft({
      allPlayers, picks: ALL_PICKS, drafted, myTeam, myPosCounts, ask,
      submitPickFn: async () => {},  // no-op, we add to myTeam in the loop
      opponentPickFn: async (pickInfo, predicted) => {
        return predicted;
      },
    });

  } else {
    // ===== LIVE MODE — MongoDB =====
    console.log(`${C.dim}Connecting to MongoDB...${C.reset}`);
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverApi: { version: "1", strict: true, deprecationErrors: true },
      connectTimeoutMS: 10000,
    });
    await client.connect();
    const db = client.db("afl_database");
    const col = db.collection(COLLECTION);
    console.log(`${C.green}Connected to MongoDB${C.reset}`);

    // Sync existing picks from DB
    let dbPicks = await fetchDraftState(col);
    const myDbPicks = dbPicks.filter(p => p.user_id === MY_USER);
    const myDbPlayersData = myDbPicks.map(pick => allPlayers.find(p => p.name === pick.player_name) || { name: pick.player_name, posScores: {} });

    // Use stored positions if all picks have them, otherwise optimize
    const allHavePositions = myDbPicks.every(p => p.position);
    let positionMap;
    if (allHavePositions) {
      positionMap = new Map(myDbPicks.map(p => [p.player_name, p.position]));
    } else {
      const { assignments } = optimizeAllPositions(myDbPlayersData);
      // Override with stored positions where present
      for (const pick of myDbPicks) {
        if (pick.position) assignments.set(pick.player_name, pick.position);
      }
      positionMap = assignments;
    }

    for (const pick of dbPicks) {
      drafted.add(pick.player_name);
      if (pick.user_id === MY_USER) {
        const playerData = allPlayers.find(p => p.name === pick.player_name);
        const pos = positionMap.get(pick.player_name) || (playerData ? playerData.bestPos : "Midfielder");
        myTeam.push({ name: pick.player_name, team: pick.team_name, draftedAs: pos, ...(playerData || {}) });
        myPosCounts[pos]++;
      }
    }
    // Pre-populate teamDrafted from DB picks
    const teamDrafted = {};
    DRAFT_ORDER.forEach(id => teamDrafted[id] = []);
    for (const pick of dbPicks) teamDrafted[pick.user_id].push(pick.player_name);

    if (dbPicks.length > 0) {
      console.log(`\n${C.green}Synced ${dbPicks.length} picks from DB (${myTeam.length} are yours)${C.reset}`);
      printTeam(myTeam, myPosCounts);
    }

    await runDraft({
      allPlayers, picks: ALL_PICKS.filter(p => p.pick > dbPicks.length),
      drafted, myTeam, myPosCounts, ask, teamDrafted,
      submitPickFn: async (pickInfo, player, pos) => {
        await submitPick(col, pickInfo.pick, pickInfo.round, MY_USER, player.name, player.team, pos);
      },
      opponentPickFn: async (pickInfo, predicted, available) => {
        process.stdout.write(`  ${C.dim}(type player name to enter manually, or wait for DB)${C.reset}\n`);

        let resolveManual;
        const manualPick = new Promise(r => { resolveManual = r; });

        const lineHandler = async (input) => {
          const trimmed = input.trim();
          if (!trimmed) return;
          const found = findPlayer(trimmed, available);
          if (!found) {
            process.stdout.write(`  ${C.red}Not found: "${trimmed}" — try again${C.reset}\n`);
          } else if (Array.isArray(found)) {
            process.stdout.write(`  ${C.yellow}Multiple matches: ${found.map(p => dn(p.name)).join(", ")}${C.reset}\n`);
          } else {
            await submitPick(col, pickInfo.pick, pickInfo.round, pickInfo.userId, found.name, found.team);
            process.stdout.write(`  ${C.green}Submitted: ${dn(found.name)} for ${USER_NAMES[pickInfo.userId]}${C.reset}\n`);
            resolveManual({ name: found.name, team: found.team });
          }
        };
        rl.on('line', lineHandler);

        const pollPick = (async () => {
          let newPick = null;
          while (!newPick) {
            await sleep(POLL_INTERVAL_MS);
            dbPicks = await fetchDraftState(col);
            newPick = dbPicks.find(p => p.pick_number === pickInfo.pick);
          }
          return { name: newPick.player_name, team: newPick.team_name };
        })();

        const result = await Promise.race([manualPick, pollPick]);
        rl.removeListener('line', lineHandler);
        return result;
      },
    });

    await client.close();
  }

  printFinalSummary(myTeam);
  rl.close();
}

main().catch(e => { console.error(C.red + e.message + C.reset); process.exit(1); });

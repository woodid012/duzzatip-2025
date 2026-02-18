/**
 * DuzzaTip 2026 Snake Draft Simulator - Blended 2024+2025 Scoring
 * Draft order: [6, 4, 7, 8, 1, 3, 2, 5]
 *
 * Blending strategy:
 *   - Default: 60% 2025, 40% 2024
 *   - If 2025 games < 10 but 2024 games > 10: 40% 2025, 60% 2024
 *   - Flags: BOUNCE BACK (2024 >> 2025), INJURY RISK (2025 << 2024)
 */

const XLSX = require("xlsx");
const fs = require("fs");
const Papa = require("papaparse");

const POSITIONS = {
  "Full Forward": (s) => s.goals * 9 + s.behinds,
  "Midfielder": (s) => {
    const d = s.kicks + s.handballs;
    return Math.min(d, 30) + Math.max(0, d - 30) * 3;
  },
  "Offensive": (s) => s.goals * 7 + s.kicks,
  "Tall Forward": (s) => s.goals * 6 + s.marks * 2,
  "Tackler": (s) => s.tackles * 4 + s.handballs,
  "Ruck": (s) => {
    const t = s.hitouts + s.marks;
    if (t <= 18) return t;
    const reg = Math.max(0, 18 - s.hitouts);
    return s.hitouts + reg + (s.marks - reg) * 3;
  }
};

const POS_SHORT = { "Full Forward": "FF", "Midfielder": "MID", "Offensive": "OFF", "Tall Forward": "TF", "Tackler": "TAK", "Ruck": "RUC" };
const POS_LIST = Object.keys(POSITIONS);

const POS_CAPS = {
  "Full Forward": 3,
  "Midfielder": 4,
  "Offensive": 3,
  "Tall Forward": 3,
  "Tackler": 4,
  "Ruck": 3
};

// ===== Parse 2025 data (per-game from round-by-round CSV) =====
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
    kicks: parseInt(row.kicks) || 0, handballs: parseInt(row.handballs) || 0,
    marks: parseInt(row.marks) || 0, tackles: parseInt(row.tackles) || 0,
    hitouts: parseInt(row.hitouts) || 0, goals: parseInt(row.goals) || 0,
    behinds: parseInt(row.behinds) || 0,
  });
}

// ===== Parse 2024 data (season totals - convert to per-game) =====
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
    kicks: (parseInt(row.kicks) || 0) / games,
    handballs: (parseInt(row.handballs) || 0) / games,
    marks: (parseInt(row.marks) || 0) / games,
    tackles: (parseInt(row.tackles) || 0) / games,
    hitouts: (parseInt(row.hitouts) || 0) / games,
    goals: (parseInt(row.goals) || 0) / games,
    behinds: (parseInt(row.behinds) || 0) / games,
  };
}

// ===== Load 2026 upload list =====
const p2026 = Papa.parse(fs.readFileSync("./python/upload_list_2026.csv", "utf8"), { header: true, skipEmptyLines: true });
const available2026 = new Map();
for (const row of p2026.data) if (row.player && row.team) available2026.set(row.player.trim(), row.team.trim());

// ===== Build blended player DB =====
const players = [];
const flagsMap = {};
const allNames = new Set([...Object.keys(playerGames2025), ...Object.keys(playerStats2024)]);

for (const name of allNames) {
  const team2026 = available2026.get(name);
  if (!team2026) continue;

  const data2025 = playerGames2025[name];
  const data2024 = playerStats2024[name];
  const n2025 = data2025 ? data2025.games.length : 0;
  const n2024 = data2024 ? data2024.games : 0;

  if (n2025 < 3 && n2024 < 3) continue;

  // Calculate 2025 per-game averages
  let avg2025 = null;
  if (n2025 >= 3) {
    const n = n2025;
    avg2025 = {
      kicks: data2025.games.reduce((a, g) => a + g.kicks, 0) / n,
      handballs: data2025.games.reduce((a, g) => a + g.handballs, 0) / n,
      marks: data2025.games.reduce((a, g) => a + g.marks, 0) / n,
      tackles: data2025.games.reduce((a, g) => a + g.tackles, 0) / n,
      hitouts: data2025.games.reduce((a, g) => a + g.hitouts, 0) / n,
      goals: data2025.games.reduce((a, g) => a + g.goals, 0) / n,
      behinds: data2025.games.reduce((a, g) => a + g.behinds, 0) / n,
    };
  }

  // Determine blending weights
  let w2025, w2024;
  if (avg2025 && data2024) {
    if (n2025 < 10 && n2024 > 10) {
      w2025 = 0.4; w2024 = 0.6;
    } else {
      w2025 = 0.6; w2024 = 0.4;
    }
  } else if (avg2025) {
    w2025 = 1.0; w2024 = 0.0;
  } else {
    w2025 = 0.0; w2024 = 1.0;
  }

  // Blend per-game stats
  const blended = {};
  const statKeys = ["kicks", "handballs", "marks", "tackles", "hitouts", "goals", "behinds"];
  for (const key of statKeys) {
    const v2025 = avg2025 ? avg2025[key] : 0;
    const v2024 = data2024 ? data2024[key] : 0;
    blended[key] = v2025 * w2025 + v2024 * w2024;
  }

  // Calculate position scores from blended stats
  const posScores = {};
  let bestPos = "", bestAvg = 0;
  for (const [posName, formula] of Object.entries(POSITIONS)) {
    const avg = formula(blended);
    posScores[posName] = Math.round(avg * 10) / 10;
    if (avg > bestAvg) { bestAvg = avg; bestPos = posName; }
  }

  // Flag detection
  let flag = "";
  if (avg2025 && data2024 && n2025 >= 5 && n2024 >= 5) {
    const best2024 = Math.max(...Object.values(POSITIONS).map(f => f(data2024)));
    const best2025 = Math.max(...Object.values(POSITIONS).map(f => f(avg2025)));
    if (best2024 > best2025 * 1.25 && best2024 > 20) flag = "BOUNCE BACK";
    else if (best2025 > best2024 * 1.25 && n2025 < 15) flag = "INJURY RISK";
  }
  if (flag) flagsMap[name] = flag;

  players.push({
    name, team: team2026,
    games: n2025 || n2024,
    games2025: n2025, games2024: n2024,
    posScores, bestPos,
    bestAvg: Math.round(bestAvg * 10) / 10,
    blend: w2025 > 0 && w2024 > 0 ? w2025 + "/" + w2024 : (w2025 > 0 ? "2025 only" : "2024 only"),
    flag: flag || "",
  });
}

// Print flag summary
const bounceBack = Object.entries(flagsMap).filter(([,f]) => f === "BOUNCE BACK");
const injuryRisk = Object.entries(flagsMap).filter(([,f]) => f === "INJURY RISK");
console.log("=== PLAYER FLAGS ===");
console.log("\nBOUNCE BACK candidates (2024 significantly better than 2025):");
bounceBack.forEach(([name]) => {
  const p = players.find(x => x.name === name);
  console.log("  " + name.padEnd(28) + " 2025:" + p.games2025 + "g  2024:" + p.games2024 + "g  blend:" + p.blend);
});
console.log("\nINJURY RISK (fewer 2025 games, may regress):");
injuryRisk.forEach(([name]) => {
  const p = players.find(x => x.name === name);
  console.log("  " + name.padEnd(28) + " 2025:" + p.games2025 + "g  2024:" + p.games2024 + "g  blend:" + p.blend);
});
console.log("");
// Composite ranking (how others draft)
for (const posName of POS_LIST) {
  const max = Math.max(...players.map(p => p.posScores[posName]));
  const min = Math.min(...players.map(p => p.posScores[posName]));
  for (const p of players) {
    if (!p.normScores) p.normScores = {};
    p.normScores[posName] = max > min ? ((p.posScores[posName] - min) / (max - min)) * 100 : 50;
  }
}
for (const p of players) p.compositeValue = Math.max(...Object.values(p.normScores));

// ===== Draft picks =====
const DRAFT_ORDER = [6, 4, 7, 8, 1, 3, 2, 5];
const MY_USER = 4;
const allPicks = [];
for (let round = 1; round <= 18; round++) {
  const order = round % 2 === 1 ? [...DRAFT_ORDER] : [...DRAFT_ORDER].reverse();
  order.forEach(userId => allPicks.push({ pick: allPicks.length + 1, round, userId }));
}
const myPickNums = allPicks.filter(p => p.userId === MY_USER).map(p => p.pick);

console.log("Your picks: " + myPickNums.join(", "));
console.log("");

// ===== Smart Draft Simulation =====
const drafted = new Set();
const myDraftLog = [];
const myPosCounts = {};
POS_LIST.forEach(p => myPosCounts[p] = 0);

function pickForMyTeam(availPlayers, pickIdx) {
  let bestChoice = null;
  let bestScore = -Infinity;
  const unfilledPositions = POS_LIST.filter(p => myPosCounts[p] === 0);

  for (const player of availPlayers) {
    for (const posName of POS_LIST) {
      if (myPosCounts[posName] >= POS_CAPS[posName]) continue;
      const rawScore = player.posScores[posName];
      let value;

      if (pickIdx < 6) {
        if (unfilledPositions.includes(posName)) { value = rawScore * 3; }
        else if (myPosCounts[posName] === 1) { value = rawScore * 0.5; }
        else { value = rawScore * 0.1; }
      } else if (pickIdx < 9) {
        if (unfilledPositions.includes(posName)) { value = rawScore * 4; }
        else if (myPosCounts[posName] === 1) { value = rawScore * 1.5; }
        else { value = rawScore * 0.2; }
      } else if (pickIdx < 14) {
        if (unfilledPositions.includes(posName)) { value = rawScore * 5; }
        else if (myPosCounts[posName] === 1) { value = rawScore * 2; }
        else if (myPosCounts[posName] === 2) { value = rawScore * 1; }
        else { value = rawScore * 0.3; }
      } else {
        if (myPosCounts[posName] < 2) { value = rawScore * 2; }
        else { value = rawScore * 0.8; }
      }

      const aboveAvgPositions = POS_LIST.filter(p =>
        player.posScores[p] > (posName === "Ruck" ? 20 : posName === "Tackler" ? 25 : 15)
      ).length;
      if (aboveAvgPositions >= 2) value *= 1.1;
      if (aboveAvgPositions >= 3) value *= 1.15;

      if (value > bestScore) {
        bestScore = value;
        bestChoice = { player, pos: posName, value };
      }
    }
  }
  return bestChoice;
}

// Run the draft
for (const pick of allPicks) {
  const available = players.filter(p => !drafted.has(p.name));
  if (pick.userId === MY_USER) {
    const choice = pickForMyTeam(available, myDraftLog.length);
    if (choice) {
      drafted.add(choice.player.name);
      myPosCounts[choice.pos]++;
      myDraftLog.push({
        pick: pick.pick, round: pick.round,
        player: choice.player.name, team: choice.player.team,
        pos: choice.pos, posScore: choice.player.posScores[choice.pos],
        games: choice.player.games,
        games2025: choice.player.games2025,
        games2024: choice.player.games2024,
        blend: choice.player.blend,
        flag: choice.player.flag,
        allScores: { ...choice.player.posScores },
      });
    }
  } else {
    const best = available.sort((a, b) => b.compositeValue - a.compositeValue)[0];
    if (best) drafted.add(best.name);
  }
}

// ===== Output =====
console.log("=== YOUR OPTIMAL 18-PLAYER DRAFT (Blended 2024+2025) ===\n");
console.log("Pick | Rd | Player                    | Team | Position       | Score | Blend    | Flag          | All Position Scores");
console.log("-".repeat(160));

myDraftLog.forEach((d, i) => {
  const allStr = POS_LIST.map(p => POS_SHORT[p] + ":" + d.allScores[p]).join("  ");
  const phase = i < 6 ? "STARTER" : i < 9 ? "CORE" : i < 14 ? "DEPTH" : "SQUAD";
  console.log(
    String(d.pick).padStart(4) + " | " + String(d.round).padStart(2) + " | " +
    d.player.padEnd(25) + " | " + d.team.padEnd(4) + " | " +
    d.pos.padEnd(14) + " | " + String(d.posScore).padStart(5) + " | " +
    d.blend.padEnd(8) + " | " + (d.flag || "-").padEnd(13) + " | " + allStr + "  " + phase
  );
});

// Position summary
console.log("\n=== POSITION COVERAGE ===");
for (const posName of POS_LIST) {
  const posPlayers = myDraftLog.filter(d => d.pos === posName);
  console.log("\n  " + posName + " (" + posPlayers.length + " players):");
  posPlayers.forEach(d => {
    const flagStr = d.flag ? " [" + d.flag + "]" : "";
    console.log("    " + d.player.padEnd(25) + " " + d.posScore + " avg (25g:" + d.games2025 + " 24g:" + d.games2024 + ")" + flagStr);
  });
}

// ===== Optimal Starting Lineup =====
console.log("\n=== OPTIMAL STARTING LINEUP ===\n");
const lineup = {};
const used = new Set();

for (let pass = 0; pass < 6; pass++) {
  for (const posName of POS_LIST) {
    if (lineup[posName]) continue;
    const candidates = myDraftLog
      .filter(d => !used.has(d.player))
      .sort((a, b) => b.allScores[posName] - a.allScores[posName]);
    if (candidates.length > 0) {
      const cand = candidates[0];
      const otherUnfilled = POS_LIST.filter(p => p !== posName && !lineup[p]);
      const betterElsewhere = otherUnfilled.some(p => cand.allScores[p] > cand.allScores[posName]);
      if (!betterElsewhere || pass >= 3) {
        lineup[posName] = cand;
        used.add(cand.player);
      }
    }
  }
}

let totalLineupScore = 0;
for (const posName of POS_LIST) {
  const p = lineup[posName];
  if (p) {
    const score = p.allScores[posName];
    totalLineupScore += score;
    const flagStr = p.flag ? " [" + p.flag + "]" : "";
    console.log("  " + posName.padEnd(14) + ": " + p.player.padEnd(25) + " -> " + score + " pts/game" + flagStr);
  }
}

const remaining = myDraftLog.filter(d => !used.has(d.player));
console.log("  ---");
if (remaining.length > 0) {
  console.log("  " + "Bench".padEnd(14) + ": " + remaining[0].player.padEnd(25) + " -> " + remaining[0].pos + " (" + remaining[0].posScore + ")");
  totalLineupScore += remaining[0].posScore * 0.3;
}
if (remaining.length > 1) {
  console.log("  " + "Reserve A".padEnd(14) + ": " + remaining[1].player.padEnd(25) + " -> covers FF/TF/RUC");
}
if (remaining.length > 2) {
  console.log("  " + "Reserve B".padEnd(14) + ": " + remaining[2].player.padEnd(25) + " -> covers OFF/MID/TAK");
}
console.log("\n  Projected starting score: ~" + Math.round(totalLineupScore) + " pts/week (before bench subs & tipping)");

// ===== Show what other teams likely draft =====
console.log("\n=== FIRST 3 ROUNDS - EXPECTED BOARD ===\n");
const drafted2 = new Set();
for (const pick of allPicks.slice(0, 24)) {
  const avail = players.filter(p => !drafted2.has(p.name)).sort((a, b) => b.compositeValue - a.compositeValue);
  if (pick.userId === MY_USER) {
    const d = myDraftLog.find(x => x.pick === pick.pick);
    if (d) {
      drafted2.add(d.player);
      console.log("  Pick " + String(pick.pick).padStart(2) + " Rd " + pick.round + " >>> YOU  : " + d.player.padEnd(25) + " " + d.pos.padEnd(14) + " " + d.posScore);
    }
  } else {
    if (avail[0]) {
      drafted2.add(avail[0].name);
      console.log("  Pick " + String(pick.pick).padStart(2) + " Rd " + pick.round + "  User " + pick.userId + " : " + avail[0].name.padEnd(25) + " " + avail[0].bestPos.padEnd(14) + " " + avail[0].bestAvg);
    }
  }
}

// ===== Write to xlsx =====
const wb = XLSX.readFile("./public/afl-fantasy-2026.xlsx");

const sheetData = [
  ["DUZZATIP 2026 SNAKE DRAFT - BLENDED 2024+2025 SCORING"],
  ["Draft Order: [6, 4, 7, 8, 1, 3, 2, 5]"],
  ["Your picks: " + myPickNums.join(", ")],
  ["Blending: 60/40 (2025/2024) default, 40/60 for low-sample 2025"],
  [""],
  ["DRAFT PLAN"],
  ["Pick#", "Round", "Player", "Team", "Target Position", "DT Score", "2025 Games", "2024 Games", "Blend", "Flag",
   "FF", "MID", "OFF", "TF", "TAK", "RUC", "Phase"]
];

myDraftLog.forEach((d, i) => {
  const phase = i < 6 ? "Elite Starter" : i < 9 ? "Core Team" : i < 14 ? "Depth" : "Squad";
  sheetData.push([
    d.pick, d.round, d.player, d.team, d.pos, d.posScore, d.games2025, d.games2024, d.blend, d.flag,
    d.allScores["Full Forward"], d.allScores["Midfielder"],
    d.allScores["Offensive"], d.allScores["Tall Forward"],
    d.allScores["Tackler"], d.allScores["Ruck"], phase
  ]);
});

sheetData.push([""], ["STARTING LINEUP"]);
sheetData.push(["Position", "Player", "DT Score", "Flag"]);
for (const posName of POS_LIST) {
  const p = lineup[posName];
  if (p) sheetData.push([posName, p.player, p.allScores[posName], p.flag]);
}
if (remaining.length > 0) sheetData.push(["Bench", remaining[0].player, remaining[0].posScore]);
if (remaining.length > 1) sheetData.push(["Reserve A", remaining[1].player, "FF/TF/RUC cover"]);
if (remaining.length > 2) sheetData.push(["Reserve B", remaining[2].player, "OFF/MID/TAK cover"]);

// Expected board
sheetData.push([""], ["EXPECTED PICKS BY OTHERS (first 4 rounds)"]);
sheetData.push(["Pick#", "Round", "User", "Player", "Position", "Score"]);
const drafted3 = new Set();
for (const pick of allPicks.slice(0, 32)) {
  const avail = players.filter(p => !drafted3.has(p.name)).sort((a, b) => b.compositeValue - a.compositeValue);
  if (pick.userId === MY_USER) {
    const d = myDraftLog.find(x => x.pick === pick.pick);
    if (d) { drafted3.add(d.player); sheetData.push([pick.pick, pick.round, "YOU", d.player, d.pos, d.posScore]); }
  } else {
    if (avail[0]) { drafted3.add(avail[0].name); sheetData.push([pick.pick, pick.round, "User " + pick.userId, avail[0].name, avail[0].bestPos, avail[0].bestAvg]); }
  }
}

// Alternatives
sheetData.push([""], ["ALTERNATIVES (if target taken)"]);
sheetData.push(["Your Pick#", "Primary", "Pos", "Score", "Alt 1", "Pos", "Score", "Alt 2", "Pos", "Score", "Alt 3", "Pos", "Score"]);
const drafted4 = new Set();
for (const pick of allPicks) {
  const avail = players.filter(p => !drafted4.has(p.name));
  if (pick.userId === MY_USER) {
    const d = myDraftLog.find(x => x.pick === pick.pick);
    if (d) {
      const alts = avail
        .filter(p => p.name !== d.player)
        .sort((a, b) => b.posScores[d.pos] - a.posScores[d.pos])
        .slice(0, 3);
      sheetData.push([
        d.pick, d.player, d.pos, d.posScore,
        alts[0]?.name || "", alts[0]?.bestPos || "", alts[0]?.posScores[d.pos] || "",
        alts[1]?.name || "", alts[1]?.bestPos || "", alts[1]?.posScores[d.pos] || "",
        alts[2]?.name || "", alts[2]?.bestPos || "", alts[2]?.posScores[d.pos] || ""
      ]);
      drafted4.add(d.player);
    }
  } else {
    const best = avail.sort((a, b) => b.compositeValue - a.compositeValue)[0];
    if (best) drafted4.add(best.name);
  }
}

// Flagged players
sheetData.push([""], ["FLAGGED PLAYERS"]);
sheetData.push(["Player", "Team", "Flag", "2025 Games", "2024 Games", "Blend", "Best Position", "Best Score"]);
players.filter(p => p.flag).sort((a, b) => b.bestAvg - a.bestAvg).forEach(p => {
  sheetData.push([p.name, p.team, p.flag, p.games2025, p.games2024, p.blend, p.bestPos, p.bestAvg]);
});

const draftWs = XLSX.utils.aoa_to_sheet(sheetData);
draftWs["!cols"] = [
  { wch: 8 }, { wch: 6 }, { wch: 25 }, { wch: 6 }, { wch: 16 }, { wch: 9 }, { wch: 10 }, { wch: 10 },
  { wch: 10 }, { wch: 14 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 14 }
];

const existingIdx = wb.SheetNames.indexOf("DT-My Draft Plan");
if (existingIdx >= 0) {
  wb.SheetNames.splice(existingIdx, 1);
  delete wb.Sheets["DT-My Draft Plan"];
  if (wb.Workbook?.Sheets) wb.Workbook.Sheets.splice(existingIdx, 1);
}
XLSX.utils.book_append_sheet(wb, draftWs, "DT-My Draft Plan");
if (!wb.Workbook) wb.Workbook = {};
if (!wb.Workbook.Sheets) wb.Workbook.Sheets = [];
while (wb.Workbook.Sheets.length < wb.SheetNames.length) wb.Workbook.Sheets.push({});
wb.Workbook.Sheets[wb.SheetNames.indexOf("DT-My Draft Plan")] = { Hidden: 1 };

XLSX.writeFile(wb, "./public/afl-fantasy-2026.xlsx");
console.log("\n\nDraft plan saved to hidden sheet \"DT-My Draft Plan\"");

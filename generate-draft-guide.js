/**
 * DuzzaTip 2026 Draft Guide Generator
 *
 * Reads 2025 AFL stats, calculates DuzzaTip position scores,
 * cross-references with 2026 available players, and creates
 * a hidden draft guide sheet in the xlsx file.
 */

const XLSX = require('xlsx');
const fs = require('fs');
const Papa = require('papaparse');

// ===== DuzzaTip Scoring Formulas =====
const POSITION_FORMULAS = {
  'Full Forward': (s) => s.goals * 9 + s.behinds,
  'Midfielder': (s) => {
    const disposals = s.kicks + s.handballs;
    const base = Math.min(disposals, 30);
    const extra = Math.max(0, disposals - 30);
    return base + extra * 3;
  },
  'Offensive': (s) => s.goals * 7 + s.kicks,
  'Tall Forward': (s) => s.goals * 6 + s.marks * 2,
  'Tackler': (s) => s.tackles * 4 + s.handballs,
  'Ruck': (s) => {
    const total = s.hitouts + s.marks;
    if (total <= 18) return total;
    const regularMarks = Math.max(0, 18 - s.hitouts);
    const bonusMarks = s.marks - regularMarks;
    return s.hitouts + regularMarks + bonusMarks * 3;
  }
};

// ===== 1. Parse 2025 Stats CSV =====
const csvRaw = fs.readFileSync('./afl-stats-1771399552485.csv', 'utf8');
// Skip first 3 lines (header info)
const csvLines = csvRaw.split('\n');
const csvData = csvLines.slice(3).join('\n');
const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });

// Build per-player game stats
const playerGames = {}; // { playerName: { team, games: [{stats}] } }

for (const row of parsed.data) {
  if (!row.player || !row.team) continue;
  const name = row.player.trim();
  const team = row.team.trim();

  // Only use regular season (rounds 1-24) and exclude very low TOG games
  const round = parseInt(row.round);
  const tog = parseFloat(row.tog) || 0;
  if (round < 1 || tog < 50) continue;

  const stats = {
    round,
    kicks: parseInt(row.kicks) || 0,
    handballs: parseInt(row.handballs) || 0,
    marks: parseInt(row.marks) || 0,
    tackles: parseInt(row.tackles) || 0,
    hitouts: parseInt(row.hitouts) || 0,
    goals: parseInt(row.goals) || 0,
    behinds: parseInt(row.behinds) || 0,
    tog,
    fantasyPoints: parseFloat(row.fantasyPoints) || 0,
    namedPosition: row.namedPosition || ''
  };

  if (!playerGames[name]) {
    playerGames[name] = { team, games: [] };
  }
  playerGames[name].games.push(stats);
}

// ===== 2. Load 2026 available players =====
const playerList2026Raw = fs.readFileSync('./python/upload_list_2026.csv', 'utf8');
const playerList2026 = Papa.parse(playerList2026Raw, { header: true, skipEmptyLines: true });
const available2026 = new Map();
for (const row of playerList2026.data) {
  if (row.player && row.team) {
    available2026.set(row.player.trim(), row.team.trim());
  }
}

// ===== 3. Load xlsx for 2024/2023 fantasy averages =====
const wb = XLSX.readFile('./public/afl-fantasy-2026.xlsx');
const ws = wb.Sheets['afl-fantasy-2026'];
const xlsxData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Row 9 (index 8) is headers
const xlsxPlayerData = {};
for (let i = 9; i < xlsxData.length; i++) {
  const row = xlsxData[i];
  if (!row[0]) continue;
  const name = row[0].toString().trim();
  xlsxPlayerData[name] = {
    salary: row[4] || '',
    owned: row[5] || '',
    position: row[6] || '',
    gms2025: row[7] || '',
    fp2025: row[8] || '',
    reg2025: row[14] || '',
    l5_2025: row[15] || '',
    fp2024: row[17] || '',
    fp2023: row[18] || ''
  };
}

// ===== 4. Calculate DuzzaTip scores per player =====
const playerScores = [];

for (const [name, data] of Object.entries(playerGames)) {
  // Only include players available in 2026
  const team2026 = available2026.get(name);
  if (!team2026) continue;

  const games = data.games;
  if (games.length < 3) continue; // Need at least 3 games for meaningful avg

  const numGames = games.length;

  // Calculate per-game scores for each position
  const posScores = {};
  for (const [posName, formula] of Object.entries(POSITION_FORMULAS)) {
    const gameScores = games.map(g => formula(g));
    const total = gameScores.reduce((a, b) => a + b, 0);
    const avg = total / numGames;
    const max = Math.max(...gameScores);
    const min = Math.min(...gameScores);
    // Consistency: % of games scoring above median
    gameScores.sort((a, b) => a - b);
    const median = gameScores[Math.floor(numGames / 2)];

    posScores[posName] = {
      avg: Math.round(avg * 10) / 10,
      max,
      min,
      total
    };
  }

  // Find best position
  let bestPos = '';
  let bestAvg = 0;
  for (const [pos, scores] of Object.entries(posScores)) {
    if (scores.avg > bestAvg) {
      bestAvg = scores.avg;
      bestPos = pos;
    }
  }

  // Get supplementary data from xlsx
  const xlsxInfo = xlsxPlayerData[name] || {};

  // Determine primary AFL position from most common named position
  const posCount = {};
  for (const g of games) {
    if (g.namedPosition) {
      posCount[g.namedPosition] = (posCount[g.namedPosition] || 0) + 1;
    }
  }
  const primaryPos = Object.entries(posCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // Average raw stats
  const avgStats = {
    kicks: Math.round(games.reduce((a, g) => a + g.kicks, 0) / numGames * 10) / 10,
    handballs: Math.round(games.reduce((a, g) => a + g.handballs, 0) / numGames * 10) / 10,
    marks: Math.round(games.reduce((a, g) => a + g.marks, 0) / numGames * 10) / 10,
    tackles: Math.round(games.reduce((a, g) => a + g.tackles, 0) / numGames * 10) / 10,
    hitouts: Math.round(games.reduce((a, g) => a + g.hitouts, 0) / numGames * 10) / 10,
    goals: Math.round(games.reduce((a, g) => a + g.goals, 0) / numGames * 10) / 10,
    behinds: Math.round(games.reduce((a, g) => a + g.behinds, 0) / numGames * 10) / 10,
    disposals: Math.round(games.reduce((a, g) => a + g.kicks + g.handballs, 0) / numGames * 10) / 10,
    tog: Math.round(games.reduce((a, g) => a + g.tog, 0) / numGames * 10) / 10,
    fantasyPts: Math.round(games.reduce((a, g) => a + g.fantasyPoints, 0) / numGames * 10) / 10
  };

  playerScores.push({
    name,
    team2025: data.team,
    team2026,
    games: numGames,
    aflPos: primaryPos,
    bestPos,
    bestAvg,
    posScores,
    avgStats,
    xlsxInfo
  });
}

// Sort by best position average score (overall value)
playerScores.sort((a, b) => b.bestAvg - a.bestAvg);

// ===== 5. Build the sheets =====

// --- Sheet 1: OVERALL DRAFT BOARD (sorted by best DuzzaTip score) ---
const overallHeaders = [
  'Rank', 'Player', 'Team 2026', 'Team 2025', 'Games', 'AFL Pos',
  'Best DT Position', 'Best DT Avg',
  'FF Avg', 'MID Avg', 'OFF Avg', 'TF Avg', 'TAK Avg', 'RUC Avg',
  'Avg Kicks', 'Avg HB', 'Avg Marks', 'Avg Tackles', 'Avg HO', 'Avg Goals', 'Avg Behinds',
  'Avg Disposals', 'Avg TOG%', 'Avg Fantasy Pts',
  'Salary', 'Owned%', 'DFS Position',
  'FP 2024 Avg', 'FP 2023 Avg'
];

const overallData = [overallHeaders];
playerScores.forEach((p, i) => {
  overallData.push([
    i + 1,
    p.name,
    p.team2026,
    p.team2025,
    p.games,
    p.aflPos,
    p.bestPos,
    p.bestAvg,
    p.posScores['Full Forward'].avg,
    p.posScores['Midfielder'].avg,
    p.posScores['Offensive'].avg,
    p.posScores['Tall Forward'].avg,
    p.posScores['Tackler'].avg,
    p.posScores['Ruck'].avg,
    p.avgStats.kicks,
    p.avgStats.handballs,
    p.avgStats.marks,
    p.avgStats.tackles,
    p.avgStats.hitouts,
    p.avgStats.goals,
    p.avgStats.behinds,
    p.avgStats.disposals,
    p.avgStats.tog,
    p.avgStats.fantasyPts,
    p.xlsxInfo.salary || '',
    p.xlsxInfo.owned ? (Math.round(p.xlsxInfo.owned * 10000) / 100) + '%' : '',
    p.xlsxInfo.position || '',
    p.xlsxInfo.fp2024 || '',
    p.xlsxInfo.fp2023 || ''
  ]);
});

// --- Per-Position Sheets ---
const positionSheets = {};
for (const posName of Object.keys(POSITION_FORMULAS)) {
  const sorted = [...playerScores].sort((a, b) => b.posScores[posName].avg - a.posScores[posName].avg);
  const headers = [
    'Rank', 'Player', 'Team 2026', 'Games', 'AFL Pos',
    `${posName} Avg`, `${posName} Max`, `${posName} Min`,
    'Best DT Pos', 'Best DT Avg',
    'Avg Kicks', 'Avg HB', 'Avg Marks', 'Avg Tackles', 'Avg HO', 'Avg Goals', 'Avg Behinds',
    'FP 2024', 'FP 2023'
  ];
  const data = [headers];
  sorted.slice(0, 100).forEach((p, i) => {
    data.push([
      i + 1,
      p.name,
      p.team2026,
      p.games,
      p.aflPos,
      p.posScores[posName].avg,
      p.posScores[posName].max,
      p.posScores[posName].min,
      p.bestPos,
      p.bestAvg,
      p.avgStats.kicks,
      p.avgStats.handballs,
      p.avgStats.marks,
      p.avgStats.tackles,
      p.avgStats.hitouts,
      p.avgStats.goals,
      p.avgStats.behinds,
      p.xlsxInfo.fp2024 || '',
      p.xlsxInfo.fp2023 || ''
    ]);
  });
  positionSheets[posName] = data;
}

// --- Sheet: DUAL POSITION VALUE (players who score well in 2+ positions) ---
const dualHeaders = [
  'Rank', 'Player', 'Team 2026', 'Games',
  'Pos 1', 'Pos 1 Avg', 'Pos 2', 'Pos 2 Avg', 'Combined Value',
  'FF', 'MID', 'OFF', 'TF', 'TAK', 'RUC'
];
const dualData = [dualHeaders];
const dualPlayers = playerScores.map(p => {
  const sortedPos = Object.entries(p.posScores)
    .sort((a, b) => b[1].avg - a[1].avg);
  return {
    ...p,
    pos1: sortedPos[0],
    pos2: sortedPos[1],
    combinedValue: sortedPos[0][1].avg + sortedPos[1][1].avg
  };
}).sort((a, b) => b.combinedValue - a.combinedValue);

dualPlayers.slice(0, 100).forEach((p, i) => {
  dualData.push([
    i + 1,
    p.name,
    p.team2026,
    p.games,
    p.pos1[0], p.pos1[1].avg,
    p.pos2[0], p.pos2[1].avg,
    Math.round(p.combinedValue * 10) / 10,
    p.posScores['Full Forward'].avg,
    p.posScores['Midfielder'].avg,
    p.posScores['Offensive'].avg,
    p.posScores['Tall Forward'].avg,
    p.posScores['Tackler'].avg,
    p.posScores['Ruck'].avg
  ]);
});

// --- Sheet: DRAFT STRATEGY GUIDE ---
const stratHeaders = [
  'Category', 'Recommendation', 'Player', 'Team', 'DT Avg', 'Notes'
];
const stratData = [stratHeaders];

// Top pick per position
for (const posName of Object.keys(POSITION_FORMULAS)) {
  const sorted = [...playerScores].sort((a, b) => b.posScores[posName].avg - a.posScores[posName].avg);
  const top3 = sorted.slice(0, 3);
  top3.forEach((p, i) => {
    stratData.push([
      `Top ${posName}`,
      i === 0 ? 'MUST DRAFT' : i === 1 ? 'HIGH VALUE' : 'STRONG PICK',
      p.name,
      p.team2026,
      p.posScores[posName].avg,
      `${p.games} games, Best pos: ${p.bestPos} (${p.bestAvg})`
    ]);
  });
  stratData.push(['', '', '', '', '', '']); // spacer
}

// Versatile players (score well in 3+ positions above average)
stratData.push(['', '', '', '', '', '']);
stratData.push(['VERSATILE PICKS', 'Players scoring well in multiple DuzzaTip positions', '', '', '', '']);

const positionAverages = {};
for (const posName of Object.keys(POSITION_FORMULAS)) {
  const allScores = playerScores.map(p => p.posScores[posName].avg);
  positionAverages[posName] = allScores.reduce((a, b) => a + b, 0) / allScores.length;
}

const versatile = playerScores.filter(p => {
  let aboveAvgCount = 0;
  for (const [posName, scores] of Object.entries(p.posScores)) {
    if (scores.avg > positionAverages[posName] * 1.5) aboveAvgCount++;
  }
  return aboveAvgCount >= 3;
}).slice(0, 15);

versatile.forEach(p => {
  const goodPositions = Object.entries(p.posScores)
    .filter(([posName, scores]) => scores.avg > positionAverages[posName] * 1.5)
    .map(([posName, scores]) => `${posName}: ${scores.avg}`)
    .join(', ');
  stratData.push([
    'Versatile',
    'FLEX VALUE',
    p.name,
    p.team2026,
    p.bestAvg,
    goodPositions
  ]);
});

// ===== 6. Write sheets to xlsx =====
// Add all sheets
const wsOverall = XLSX.utils.aoa_to_sheet(overallData);

// Set column widths
wsOverall['!cols'] = [
  { wch: 5 },   // Rank
  { wch: 25 },  // Player
  { wch: 6 },   // Team 2026
  { wch: 6 },   // Team 2025
  { wch: 6 },   // Games
  { wch: 8 },   // AFL Pos
  { wch: 15 },  // Best DT Position
  { wch: 10 },  // Best DT Avg
  { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },  // Position avgs
  { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },  // Raw stats
  { wch: 10 }, { wch: 8 }, { wch: 10 },  // Disposals, TOG, FP
  { wch: 10 }, { wch: 8 }, { wch: 10 },  // Salary, Owned, DFS Pos
  { wch: 10 }, { wch: 10 }  // 2024, 2023
];

XLSX.utils.book_append_sheet(wb, wsOverall, 'DT Draft Board');

// Per-position sheets
for (const [posName, data] of Object.entries(positionSheets)) {
  const shortName = posName.replace('Full Forward', 'DT-FF')
    .replace('Midfielder', 'DT-MID')
    .replace('Offensive', 'DT-OFF')
    .replace('Tall Forward', 'DT-TF')
    .replace('Tackler', 'DT-TAK')
    .replace('Ruck', 'DT-RUC');
  const posWs = XLSX.utils.aoa_to_sheet(data);
  posWs['!cols'] = [
    { wch: 5 }, { wch: 25 }, { wch: 6 }, { wch: 6 }, { wch: 8 },
    { wch: 10 }, { wch: 8 }, { wch: 8 },
    { wch: 15 }, { wch: 10 },
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 10 }
  ];
  XLSX.utils.book_append_sheet(wb, posWs, shortName);
}

// Dual position sheet
const dualWs = XLSX.utils.aoa_to_sheet(dualData);
dualWs['!cols'] = [
  { wch: 5 }, { wch: 25 }, { wch: 6 }, { wch: 6 },
  { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 12 },
  { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }
];
XLSX.utils.book_append_sheet(wb, dualWs, 'DT-Dual Value');

// Strategy sheet
const stratWs = XLSX.utils.aoa_to_sheet(stratData);
stratWs['!cols'] = [
  { wch: 18 }, { wch: 15 }, { wch: 25 }, { wch: 6 }, { wch: 8 }, { wch: 60 }
];
XLSX.utils.book_append_sheet(wb, stratWs, 'DT-Strategy');

// Save
XLSX.writeFile(wb, './public/afl-fantasy-2026.xlsx');

console.log('=== DRAFT GUIDE GENERATED ===');
console.log(`Total players analysed: ${playerScores.length}`);
console.log(`Sheets added: DT Draft Board, DT-FF, DT-MID, DT-OFF, DT-TF, DT-TAK, DT-RUC, DT-Dual Value, DT-Strategy`);
console.log('');
console.log('=== TOP 20 OVERALL (by best position score) ===');
playerScores.slice(0, 20).forEach((p, i) => {
  console.log(`${i+1}. ${p.name} (${p.team2026}) - ${p.bestPos}: ${p.bestAvg} | FF:${p.posScores['Full Forward'].avg} MID:${p.posScores['Midfielder'].avg} OFF:${p.posScores['Offensive'].avg} TF:${p.posScores['Tall Forward'].avg} TAK:${p.posScores['Tackler'].avg} RUC:${p.posScores['Ruck'].avg}`);
});

console.log('');
console.log('=== TOP 5 PER POSITION ===');
for (const posName of Object.keys(POSITION_FORMULAS)) {
  console.log(`\n--- ${posName} ---`);
  const sorted = [...playerScores].sort((a, b) => b.posScores[posName].avg - a.posScores[posName].avg);
  sorted.slice(0, 5).forEach((p, i) => {
    console.log(`  ${i+1}. ${p.name} (${p.team2026}) - ${p.posScores[posName].avg} avg (max: ${p.posScores[posName].max})`);
  });
}

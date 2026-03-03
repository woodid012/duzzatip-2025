/**
 * GET/POST /api/stats-report
 *
 * Returns player position scores based on 2025 season data.
 * Useful for openclaw to understand squad strengths and optimal lineup placement.
 *
 * Auth: ?token=<NOTIFY_SECRET>  or  Authorization: Bearer <NOTIFY_SECRET>
 *
 * Query params:
 *   ?send=1          — also send the report to Telegram (@woodenduck_bot)
 *   ?league=1        — include league-wide top players (default: squad only)
 *   ?pos=MID         — filter to a single position
 *   ?top=10          — how many league leaders to show per position (default 8, only with ?league=1)
 *   ?format=text     — return plain text instead of JSON (default: json)
 */

import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/app/lib/mongodb';

const MY_USER   = 4;
const YEAR_2025 = 2025;
const MIN_GAMES = 5;
const MIN_TOG   = 50;

// ===== Scoring formulas =====
const SCORE_FNS = {
  FF:  (s) => s.goals * 9 + s.behinds,
  TF:  (s) => s.goals * 6 + s.marks * 2,
  OFF: (s) => s.goals * 7 + s.kicks,
  MID: (s) => { const d = s.kicks + s.handballs; return Math.min(d, 30) + Math.max(0, d - 30) * 3; },
  TAK: (s) => s.tackles * 4 + s.handballs,
  RUC: (s) => {
    const t = s.hitouts + s.marks;
    if (t <= 18) return t;
    const reg = Math.max(0, 18 - s.hitouts);
    return s.hitouts + reg + (s.marks - reg) * 3;
  },
};

const POS_FULL = {
  FF:  'Full Forward (Goals×9 + Behinds)',
  TF:  'Tall Forward (Goals×6 + Marks×2)',
  OFF: 'Offensive   (Goals×7 + Kicks)',
  MID: 'Midfielder  (Disp≤30×1 + extra×3)',
  TAK: 'Tackler     (Tackles×4 + HBs)',
  RUC: 'Ruck        (HO+Marks, bonus×3)',
};

const RESERVE_A = ['FF', 'TF', 'RUC'];
const RESERVE_B = ['OFF', 'MID', 'TAK'];

// ===== Helpers =====
function dn(name) {
  const parts = (name || '').trim().split(' ');
  return parts.length < 2 ? name : `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
}

function calcAvg(games) {
  const keys = ['kicks', 'handballs', 'marks', 'tackles', 'hitouts', 'goals', 'behinds'];
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

// ===== Auth =====
function checkAuth(request) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret) return true; // no secret set = open
  const { searchParams } = new URL(request.url);
  const tokenParam = searchParams.get('token');
  const authHeader = request.headers.get('authorization') || '';
  const headerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  return tokenParam === secret || headerToken === secret;
}

// ===== Telegram =====
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const CHAT_ID = '8600335192';
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
  });
  const data = await res.json();
  return data.ok === true;
}

// ===== Build data =====
async function buildPositionData(db) {
  // Load 2025 game results
  const docs = await db.collection(`${YEAR_2025}_game_results`)
    .find({ timeOnGroundPercentage: { $gte: MIN_TOG } })
    .toArray();

  // Group by player
  const byPlayer = {};
  for (const d of docs) {
    const name = d.player_name;
    if (!byPlayer[name]) byPlayer[name] = { name, team: d.team_name, games: [] };
    byPlayer[name].games.push(d);
  }

  // Build scored player list
  const players = [];
  for (const data of Object.values(byPlayer)) {
    if (data.games.length < MIN_GAMES) continue;
    const avg    = calcAvg(data.games);
    const scores = scoreAll(avg);
    players.push({ name: data.name, team: data.team, games: data.games.length, scores, best: bestPos(scores) });
  }

  // Load squad
  const squadDocs = await db.collection('2026_squads')
    .find({ user_id: MY_USER, Active: { $ne: 0 } })
    .toArray();
  const squadNames = squadDocs.map(d => d.player_name).filter(Boolean);
  const squadSet   = new Set(squadNames.map(n => n.toLowerCase()));

  return { players, squadNames, squadSet };
}

// ===== Format text report =====
function buildTextReport({ players, squadNames, squadSet }, { posFilter, topN, squadOnly }) {
  const positions = posFilter ? [posFilter] : Object.keys(SCORE_FNS);
  const messages  = [];

  // Header
  messages.push([
    `🏉 DuzzaTip — 2025 Player Scores by Position`,
    `📊 ${players.length} players (min ${MIN_GAMES}g, TOG≥${MIN_TOG}%)`,
    ``,
    `Positions: FF TF OFF MID TAK RUC`,
    `Reserve A covers: FF/TF/RUC`,
    `Reserve B covers: OFF/MID/TAK`,
  ].join('\n'));

  // Per position (group 2 per message)
  const groups = [];
  for (let i = 0; i < positions.length; i += 2) groups.push(positions.slice(i, i + 2));

  for (const group of groups) {
    const lines = [];
    for (const pos of group) {
      const sorted    = [...players].sort((a, b) => b.scores[pos] - a.scores[pos]);
      const leagueAvg = (sorted.reduce((a, p) => a + p.scores[pos], 0) / sorted.length).toFixed(1);
      const p75       = sorted[Math.floor(sorted.length * 0.25)]?.scores[pos].toFixed(1) ?? '?';

      lines.push(`── ${pos}: ${POS_FULL[pos]} ──`);
      lines.push(`League avg: ${leagueAvg} | Top 25%: ${p75}+`);

      if (!squadOnly) {
        lines.push(`Top ${topN} overall:`);
        sorted.slice(0, topN).forEach((p, i) => {
          const flag = squadSet.has(p.name.toLowerCase()) ? ' ⭐' : '';
          lines.push(`  ${String(i+1).padStart(2)}. ${p.scores[pos].toFixed(1).padStart(5)}  ${dn(p.name)} (${p.team})${flag}`);
        });
      }

      const squadAtPos = sorted.filter(p => squadSet.has(p.name.toLowerCase()));
      if (squadAtPos.length > 0) {
        lines.push(`Your squad:`);
        for (const p of squadAtPos) {
          const rank    = sorted.findIndex(x => x.name === p.name) + 1;
          const pct     = Math.round((1 - rank / sorted.length) * 100);
          const bestFlg = p.best === pos ? ' ← BEST' : '';
          lines.push(`  #${rank}/${sorted.length}  ${p.scores[pos].toFixed(1).padStart(5)}  ${dn(p.name)} (${p.team}) top ${100-pct}%${bestFlg}`);
        }
      }
      lines.push('');
    }
    messages.push(lines.join('\n').trim());
  }

  // Squad summary
  if (squadNames.length > 0) {
    const squadPlayers = players.filter(p => squadSet.has(p.name.toLowerCase()));
    const lines = [
      `── 🦆⚡ Squad Best-Position Summary ──`,
      `Player                    Best  Score  2nd`,
      `──────────────────────────────────────────`,
    ];
    squadPlayers
      .sort((a, b) => b.scores[b.best] - a.scores[a.best])
      .forEach(p => {
        const sorted = Object.entries(p.scores).sort((a, b) => b[1] - a[1]);
        const [bp, bs] = sorted[0];
        const [sp, ss] = sorted[1] ?? ['—', 0];
        lines.push(`${dn(p.name).padEnd(26)} ${bp.padEnd(4)} ${String(bs.toFixed(1)).padStart(5)}  ${sp}:${ss.toFixed(1)}`);
      });
    lines.push('');
    lines.push('💡 Greedy max-margin algorithm assigns the position');
    lines.push('where your player has the BIGGEST edge over squad rivals.');
    messages.push(lines.join('\n'));
  }

  return messages;
}

// ===== Handler =====
async function handle(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const doSend    = searchParams.get('send') === '1';
  const squadOnly = searchParams.get('league') !== '1'; // default: squad only; ?league=1 shows all
  const posFilter = searchParams.get('pos')?.toUpperCase() || null;
  const topN      = parseInt(searchParams.get('top') || '8');
  const format    = searchParams.get('format') || 'json';

  if (posFilter && !SCORE_FNS[posFilter]) {
    return NextResponse.json({ error: `Unknown position: ${posFilter}. Use FF/TF/OFF/MID/TAK/RUC` }, { status: 400 });
  }

  try {
    const { db } = await connectToDatabase();
    const data   = await buildPositionData(db);

    // Build JSON result
    const positions = posFilter ? [posFilter] : Object.keys(SCORE_FNS);
    const json = {
      generatedAt:   new Date().toISOString(),
      dataYear:      YEAR_2025,
      totalPlayers:  data.players.length,
      squadSize:     data.squadNames.length,
      squadPlayers:  data.players
        .filter(p => data.squadSet.has(p.name.toLowerCase()))
        .sort((a, b) => b.scores[b.best] - a.scores[a.best])
        .map(p => {
          const sorted = Object.entries(p.scores).sort((a, b) => b[1] - a[1]);
          return { name: p.name, team: p.team, games: p.games, bestPos: p.best, bestScore: sorted[0][1], scores: p.scores };
        }),
      leagueLeaders: {},
    };

    for (const pos of positions) {
      const sorted = [...data.players].sort((a, b) => b.scores[pos] - a.scores[pos]);
      const avg    = sorted.reduce((a, p) => a + p.scores[pos], 0) / sorted.length;
      json.leagueLeaders[pos] = {
        formula:   POS_FULL[pos],
        leagueAvg: Math.round(avg * 10) / 10,
        top25pct:  sorted[Math.floor(sorted.length * 0.25)]?.scores[pos] ?? null,
        topPlayers: sorted.slice(0, topN).map((p, i) => ({
          rank: i + 1,
          name: p.name,
          team: p.team,
          score: p.scores[pos],
          inSquad: data.squadSet.has(p.name.toLowerCase()),
        })),
      };
    }

    // Optionally send Telegram
    let sent = false;
    if (doSend) {
      const messages = buildTextReport(data, { posFilter, topN, squadOnly });
      for (let i = 0; i < messages.length; i++) {
        sent = await sendTelegram(messages[i]);
        if (i < messages.length - 1) await new Promise(r => setTimeout(r, 600));
      }
    }

    if (format === 'text') {
      const messages = buildTextReport(data, { posFilter, topN, squadOnly });
      return new Response(messages.join('\n\n' + '─'.repeat(50) + '\n\n'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json({ ...json, sent });
  } catch (err) {
    console.error('stats-report error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export const GET  = handle;
export const POST = handle;

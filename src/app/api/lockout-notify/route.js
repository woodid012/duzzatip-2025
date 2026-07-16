/**
 * DuzzaTip 2026 — Lockout Notify API Route
 * POST /api/lockout-notify
 *
 * Called by openclaw (on Hostinger) when AFL team selections are detected.
 * Computes optimal team + tips, saves to MongoDB, sends Telegram message.
 *
 * Auth: Authorization: Bearer <NOTIFY_SECRET>
 *   or: ?token=<NOTIFY_SECRET>
 *
 * Query params:
 *   ?force=1    — skip the 24h lockout gate
 *   ?dry=1      — compute only, no DB saves or Telegram send
 *   ?round=N    — force a specific round
 *   ?probe=1    — just check if teams are announced (no compute, no send)
 */

// This endpoint is time-sensitive; disable caching.
export const dynamic = "force-dynamic";
export const revalidate = 0;
// AFL roster + Squiggle + Sportsbet + stats-report can each take 10s+; give
// the function a real budget so a slow dependency doesn't trip Vercel's
// default 60s limit and 504 the whole run.
export const maxDuration = 300;

import { connectToDatabase } from "@/app/lib/mongodb";
import {
  TEAM_ALIASES,
  findTeamSlug,
  fetchAFLTeamSelections,
  fetchSquiggleTips as fetchSquiggleTipsShared,
  fetchSportsbetOdds,
  buildTipSuggestions,
} from "@/app/lib/lockoutShared";
import { INJURIES } from "@/app/lib/injuries_2026";
import { optimiseLineup, scoreGame, DNP_RISK_BASE, DNP_RISK_FLAGGED } from "@/app/lib/lineupOptimiser";
import fs from "fs";
import path from "path";

const MY_USER = 4;
const YEAR    = 2026;
const NOTIFY_WINDOW_HOURS = 24;
const FINAL_WINDOW_MINS   = 45;
const TELEGRAM_CHAT_ID    = "8600335192";

// ── Scoring ──────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function dn(name) {
  if (!name) return name;
  const parts = name.trim().split(" ");
  return parts.length < 2 ? name : `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
}
function normName(n) {
  return (n || "").toLowerCase().replace(/'/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}
// ── Injuries (MongoDB-first, static fallback) ────────────────────────────────
async function loadInjuries(db) {
  try {
    const doc = await db.collection("injuries").findOne({ _id: `injuries_${YEAR}` });
    if (doc?.players && Object.keys(doc.players).length > 0) {
      console.log(`[injuries] Loaded ${Object.keys(doc.players).length} from MongoDB (updated ${doc.updated?.toISOString()})`);
      return doc.players;
    }
  } catch (_) {}
  console.log(`[injuries] Falling back to static INJURIES (${Object.keys(INJURIES).length} players)`);
  return INJURIES;
}

// Lookup injury by player name — keys are now "Name (Team)"
function findInjury(name, injuries) {
  if (!name) return null;
  const match = Object.keys(injuries).find(k => k.startsWith(name + " ("));
  return match ? injuries[match] : (injuries[name] || null);
}
function injSeverity(name, injuries) {
  const inj = findInjury(name, injuries);
  if (!inj) return 0;
  return { SEASON: 4, MONTHS: 3, WEEKS: 2, DOUBT: 1, MANAGED: 0 }[inj.status] ?? 0;
}
// Parse the lower-bound week count from an injury detail like "2 weeks",
// "1-2 weeks", "Hamstring, 2-3 weeks". Returns 0 if no number is present.
function injWeeksLower(detail) {
  if (!detail) return 0;
  const nums = detail.match(/\d+/g);
  if (!nums?.length) return 0;
  return Math.min(...nums.map(Number));
}
function injNote(name, injuries) {
  const inj = findInjury(name, injuries);
  if (!inj) return "";
  const labels = { SEASON: "OUT SEASON", MONTHS: "OUT MONTHS", WEEKS: "OUT WEEKS", DOUBT: "DOUBT", MANAGED: "managed" };
  return ` [${labels[inj.status]}: ${inj.detail}]`;
}
function formatGameTime(dateUtc) {
  return new Date(dateUtc).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}
function melbDay(date) {
  return date ? date.toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short" }) : "";
}
// AFL only publishes a match's named22 a few hours before bounce. For players
// whose match is more than this many hours away, treat "not in named22" as
// "team not yet selected" rather than "dropped" — keep them in the lineup
// but flag the day in the message.
const LATE_MATCH_THRESHOLD_HOURS = 6;

// ── Fixtures ──────────────────────────────────────────────────────────────────
function loadFixtures() {
  const p = path.join(process.cwd(), "public", `afl-${YEAR}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function getCurrentRound(fixtures) {
  const now = new Date();
  const upcoming = fixtures.filter(f => f.RoundNumber >= 0 && new Date(f.DateUtc) > now);
  if (!upcoming.length) return Math.max(...fixtures.map(f => f.RoundNumber));
  return upcoming[0].RoundNumber;
}
function getLockoutInfo(fixtures, round) {
  const rf = fixtures.filter(f => f.RoundNumber === round).sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));
  if (!rf.length) return null;
  const firstGame = new Date(rf[0].DateUtc);
  const now = new Date();
  const minsUntil  = Math.round((firstGame - now) / 60000);
  const hoursUntil = minsUntil / 60;
  const melbTime   = firstGame.toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", day: "numeric",
    month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  });
  return { firstGame, locked: now >= firstGame, minsUntil, hoursUntil, melbTime };
}
function getRoundFixtures(fixtures, round) {
  return fixtures.filter(f => f.RoundNumber === round).sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc));
}

// Team aliases, slug helpers, AFL roster/Squiggle/Sportsbet fetchers and the
// tip-suggestion builder are imported from @/app/lib/lockoutShared so this
// route and the lockout-notify.js CLI stay in sync.
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

// ── Player stats ──────────────────────────────────────────────────────────────
function calcAvgStats(games) {
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
// are unaffected. Uses the same per-game scoreGame() the bench model relies on.
function scorePositionsFromGames(games) {
  if (!games || !games.length) return {};
  const out = {};
  for (const pos of Object.keys(SCORE_FNS)) {
    const sum = games.reduce((a, g) => a + scoreGame(g, pos, SCORE_FNS), 0);
    out[pos] = Math.round((sum / games.length) * 10) / 10;
  }
  return out;
}
async function loadPlayerStats(db, names) {
  const stats = {};

  // 1. Try current-year in-season data (exclude round 0 preseason, deduplicate)
  try {
    const docs = await db.collection(`${YEAR}_game_results`).find({
      player_name: { $in: names },
      round: { $gte: 1 },
    }).toArray();
    const byPlayer = {};
    for (const d of docs) {
      if (!byPlayer[d.player_name]) byPlayer[d.player_name] = [];
      if (byPlayer[d.player_name].some(g => g.round === d.round)) continue; // deduplicate
      byPlayer[d.player_name].push(d);
    }
    for (const [name, games] of Object.entries(byPlayer)) {
      if (games.length >= 2) stats[name] = { source: `${YEAR}(${games.length}g)`, avg: calcAvgStats(games), games };
    }
  } catch (_) {}

  // 2. Fall back to 2025 data for players with no current-year stats (pre-season or new players)
  const need2025 = names.filter(n => !stats[n]);
  if (need2025.length > 0) {
    try {
      const docs2025 = await db.collection("2025_game_results")
        .find({ player_name: { $in: need2025 } }, { projection: { player_name: 1, kicks: 1, handballs: 1, marks: 1, tackles: 1, hitouts: 1, goals: 1, behinds: 1, _id: 0 } })
        .toArray();
      const byPlayer = {};
      for (const d of docs2025) {
        if (!byPlayer[d.player_name]) byPlayer[d.player_name] = [];
        byPlayer[d.player_name].push(d);
      }
      for (const [name, games] of Object.entries(byPlayer)) {
        if (games.length >= 3) stats[name] = { source: `2025(${games.length}g)`, avg: calcAvgStats(games), games };
      }
    } catch (_) {}
  }

  return stats;
}

// ── 2025 position scores via stats-report ─────────────────────────────────────
// Maps stats-report short keys → lockout-notify full position names
const SHORT_TO_FULL = {
  FF:  "Full Forward",
  TF:  "Tall Forward",
  OFF: "Offensive",
  MID: "Midfielder",
  TAK: "Tackler",
  RUC: "Ruck",
};

// Fetches squad 2025 position scores from the stats-report endpoint.
// Returns a map keyed by lowercase player name → { scores: {<full pos>: pts}, games }.
async function fetchSquad2025Scores() {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret) return {};
  try {
    const url = `https://duzzatip.vercel.app/api/stats-report?token=${encodeURIComponent(secret)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const byName = {};
    for (const p of (data.squadPlayers || [])) {
      const key = (p.name || "").toLowerCase().trim();
      const scores = {};
      for (const [short, full] of Object.entries(SHORT_TO_FULL)) {
        if (p.scores?.[short] != null) scores[full] = p.scores[short];
      }
      byName[key] = { scores, games: p.games ?? 0 };
    }
    return byName;
  } catch (_) {
    return {};
  }
}

// ── Optimal lineup ─────────────────────────────────────────────────────────────
// Starters, bench (player + backup position) and reserves are picked by the
// shared joint optimiser in @/app/lib/lineupOptimiser — see that module for the
// expected-value model (pairwise option value + DNP margin over reserve cover).

function buildSelectionStatus(squadPlayers, fwSelections) {
  const status = new Map();
  for (const p of squadPlayers) {
    const slug = findTeamSlug(p.team);
    if (!slug || !fwSelections[slug]) { status.set(p.name, "unknown"); continue; }
    const { named22, emergencies } = fwSelections[slug];
    const norm = normName(p.name);
    if (named22.some(fw => normName(fw) === norm)) status.set(p.name, "playing");
    else if (emergencies.some(fw => normName(fw) === norm)) status.set(p.name, "emergency");
    else status.set(p.name, "out");
  }
  return status;
}

// Thin wrapper preserves existing call-site signature; the shared version
// takes a year so it can be reused outside this route.
async function fetchSquiggleTips(round) {
  return fetchSquiggleTipsShared(round, YEAR);
}

// ── DB saves ──────────────────────────────────────────────────────────────────
async function saveTeamSelection(db, round, result) {
  const col = db.collection(`${YEAR}_team_selection`);
  const bulkOps = [{ updateMany: { filter: { Round: round, User: MY_USER }, update: { $set: { Active: 0 } } } }];
  const toSave = [
    ...MAIN_POSITIONS.map(pos => result.lineup[pos] ? { pos, name: result.lineup[pos].name } : null),
    result.bench    ? { pos: "Bench",     name: result.bench.name,    backup: result.benchBackup } : null,
    result.reserveA ? { pos: "Reserve A", name: result.reserveA.name } : null,
    result.reserveB ? { pos: "Reserve B", name: result.reserveB.name } : null,
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

// ── Notify state (MongoDB-backed, no local file on Vercel) ────────────────────
// Dual-send: "early" (24h before lockout) and "final" (30min before lockout)
async function getNotifyState(db, round) {
  try {
    const doc = await db.collection("notify_state").findOne({ _id: "lockout_notifier" });
    return doc?.rounds?.[String(round)] || null; // { early: bool, final: bool }
  } catch (_) { return null; }
}
async function markRoundNotified(db, round, sendType) {
  try {
    await db.collection("notify_state").updateOne(
      { _id: "lockout_notifier" },
      { $set: { [`rounds.${round}.${sendType}`]: true, lastNotified: new Date() } },
      { upsert: true }
    );
  } catch (_) {}
}

// ── Telegram send ─────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${data.description}`);
  return true;
}

// ── Message builder ───────────────────────────────────────────────────────────
function buildMessage({ round, lockout, result, autoExcluded, byePlayers, selectionStatus, tipSuggestions, savedTeam, savedTips, dry, injuries, isFinal, playerMatch, squad }) {
  const lockoutDay = lockout?.firstGame ? melbDay(lockout.firstGame) : "";
  // Day-of-week tag for any player whose match is on a different Melbourne day
  // than the round's first bounce (e.g. lineup is Thu but player plays Sun).
  // Signals "AFL hasn't named this team yet, double-check before lockout".
  const dayTag = (name) => {
    const f = playerMatch?.get(name);
    if (!f) return "";
    const md = melbDay(new Date(f.DateUtc));
    return md && md !== lockoutDay ? ` _(${md})_` : "";
  };
  const lines = [];
  const hrs  = Math.floor(Math.abs(lockout.minsUntil) / 60);
  const mins = Math.abs(lockout.minsUntil) % 60;
  const timeStr = lockout.locked ? `LOCKED` : `${lockout.melbTime} (${hrs}h ${mins}m)`;

  const phaseTag = isFinal ? " ⚡ FINAL Update" : " 👀 Early Preview";
  lines.push(`🦆⚡ *DuzzaTip Rd${round} —${phaseTag}*`);
  lines.push(`⏰ ${timeStr}`);
  if (dry) lines.push(`_(dry-run — nothing saved)_`);
  lines.push("");

  // ── Team ──
  let totalPts = 0;
  const teamLines = [];
  for (const pos of MAIN_POSITIONS) {
    const p = result.lineup[pos];
    if (!p) { teamLines.push(`*${POS_SHORT[pos]}* — (no player)`); continue; }
    const pts = p.scores[pos] ? Math.round(p.scores[pos]) : "?";
    if (typeof pts === "number") totalPts += pts;
    const injTag = injSeverity(p.name, injuries) >= 1 ? ` ⚠` : "";
    const srcTag = p.statsSource ? ` _[${p.statsSource}]_` : "";
    teamLines.push(`*${POS_SHORT[pos]}* — *${dn(p.name)}* _(${pts}pts)_${injTag}${dayTag(p.name)}${srcTag}`);
  }
  lines.push(`📋 *YOUR TEAM* — _~${totalPts}pts projected_`);
  for (const l of teamLines) lines.push(l);
  if (result.bench) {
    const gainStr = result.benchExpectedGain > 0 ? ` _(+${result.benchExpectedGain}pts exp)_` : "";
    lines.push(`🪑 *Bench* — *${dn(result.bench.name)}*${dayTag(result.bench.name)} → ${POS_SHORT[result.benchBackup] || "?"}${gainStr}`);
    // Show what the other backup positions were worth, so the pick is auditable.
    const alts = (result.benchOptions || []).filter(o => o.pos !== result.benchBackup).slice(0, 2);
    if (alts.length) {
      lines.push(`   _alt: ${alts.map(o => `${POS_SHORT[o.pos]} ${o.value >= 0 ? "+" : ""}${o.value}`).join(", ")}_`);
    }
  }
  if (result.reserveA) lines.push(`🅰 *Res A* — *${dn(result.reserveA.name)}*${dayTag(result.reserveA.name)}`);
  if (result.reserveB) lines.push(`🅱 *Res B* — *${dn(result.reserveB.name)}*${dayTag(result.reserveB.name)}`);
  lines.push("");

  // ── Alerts ──
  const alerts = [];
  for (const p of (byePlayers || [])) alerts.push(`🚫 *BYE* ${dn(p.name)} (${p.team})`);
  if (selectionStatus) {
    for (const [name, sel] of selectionStatus.entries()) {
      if (autoExcluded.has(name) && !(byePlayers || []).some(p => p.name === name)) {
        const inj = findInjury(name, injuries);
        alerts.push(`✗ *OUT* ${dn(name)}${inj ? ` — ${inj.detail}` : ""}`);
      } else if (sel === "emergency") {
        alerts.push(`⚡ *EMERG* ${dn(name)} — named emergency`);
      }
    }
    const allInLineup = [...Object.values(result.lineup), result.bench, result.reserveA, result.reserveB].filter(Boolean);
    for (const p of allInLineup) {
      if (injSeverity(p.name, injuries) >= 1 && !autoExcluded.has(p.name)) {
        const inj = findInjury(p.name, injuries);
        const sel = selectionStatus?.get(p.name);
        const namedTag = sel === "playing" ? " ✅ NAMED" : sel === "emergency" ? "" : "";
        alerts.push(`⚠ *DOUBT* ${dn(p.name)} — ${inj?.detail || "?"}${namedTag}`);
      }
    }
  }
  if (alerts.length > 0) {
    lines.push(`⚠️ *ALERTS*`);
    for (const a of alerts) lines.push(a);
    lines.push("");
  }

  // ── Spare ──
  // Squad players who are available (not bye/out/excluded) but didn't make
  // the team (lineup + bench + reserves) — their "best position" gives a
  // hint at what they could cover if a late change is needed.
  if (squad?.length) {
    const inTeam = new Set(
      [...Object.values(result.lineup), result.bench, result.reserveA, result.reserveB]
        .filter(Boolean).map(p => p.name)
    );
    const spares = squad
      .filter(p => !inTeam.has(p.name) && !autoExcluded.has(p.name))
      .sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
    if (spares.length) {
      lines.push(`🔄 *SPARE*`);
      for (const p of spares) {
        const posShort = POS_SHORT[p.bestPos] || "?";
        const pts = p.bestScore ? Math.round(p.bestScore) : "?";
        lines.push(`*${posShort}* — *${dn(p.name)}* _(${pts}pts)_${dayTag(p.name)}`);
      }
      lines.push("");
    }
  }

  // ── Tips ──
  if (tipSuggestions?.length) {
    lines.push(`🏈 *TIPS — Round ${round}*`);
    lines.push("");
    for (const t of tipSuggestions) {
      const dc = t.suggestDC ? " 💀 *DC*" : "";
      const home = t.favourite === t.homeTeam;
      const matchup = home
        ? `*${t.homeTeam}* v ${t.awayTeam}`
        : `${t.homeTeam} v *${t.awayTeam}*`;
      const oddsStr = t.homeOdds && t.awayOdds
        ? `  _($${t.homeOdds.toFixed(2)} / $${t.awayOdds.toFixed(2)})_`
        : "";
      lines.push(`*Pick:* *${t.favourite}*  ${t.confidence}%${dc}${oddsStr}`);
      lines.push(`${matchup}`);
      lines.push(`_${formatGameTime(t.dateUtc)}_`);
      lines.push("");
    }
  }

  lines.push(dry ? `_(dry-run: nothing saved)_` :
    savedTeam && savedTips ? `✅ Team + tips saved` :
    savedTeam ? `✅ Team saved  ⚠ Tips not saved` :
    savedTips ? `⚠ Team not saved  ✅ Tips saved` : `⚠ Nothing saved`);

  return lines.join("\n");
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function checkAuth(request) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret) return true; // no secret configured — open (not recommended)
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  const { searchParams } = new URL(request.url);
  if (searchParams.get("token") === secret) return true;
  return false;
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GET /api/lockout-notify?probe=1  — just check if teams are announced
// GET /api/lockout-notify          — same as POST (for easy browser testing with ?force=1&token=...)
export async function GET(request) {
  return handler(request);
}
export async function POST(request) {
  return handler(request);
}

async function handler(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force    = searchParams.get("force") === "1";
  const dry      = searchParams.get("dry")   === "1";
  const probe    = searchParams.get("probe") === "1";
  const warn     = searchParams.get("warn")  === "1";

  // ── Warn mode: forward a message to Telegram (used by the scheduled routine
  // to surface curl/HTTP/parse errors). Body or ?msg= param carries the text. ──
  if (warn) {
    let msg = searchParams.get("msg") || "";
    if (!msg) {
      try {
        const body = await request.json();
        msg = body?.message || body?.msg || "";
      } catch (_) {
        try { msg = await request.text(); } catch (_) {}
      }
    }
    msg = (msg || "(no message)").toString().slice(0, 3500);
    try {
      await sendTelegram(`🚨 *DuzzaTip routine warning*\n${msg}`);
      return Response.json({ ok: true, sent: true });
    } catch (e) {
      return Response.json({ ok: false, error: e.message }, { status: 500 });
    }
  }

  // preteams=1: allow lineup generation before AFL team selections are announced.
  // Still excludes bye players and long-term injuries (MONTHS/SEASON), but does NOT exclude "out" based on team selection.
  const preteams = searchParams.get("preteams") === "1";
  const roundArg = searchParams.get("round") ? parseInt(searchParams.get("round")) : null;

  const fixtures = loadFixtures();
  const round    = roundArg ?? getCurrentRound(fixtures);
  const lockout  = getLockoutInfo(fixtures, round);

  // ── Probe mode: just report whether teams are announced ──
  if (probe) {
    const { teamsFound, ppCount } = await fetchAFLTeamSelections(round);
    return Response.json({
      round, teamsFound, ppCount,
      announced: teamsFound >= 2,
      allTeams: teamsFound >= 5,
      lockout: lockout ? { melbTime: lockout.melbTime, hoursUntil: Math.round(lockout.hoursUntil), locked: lockout.locked } : null,
    });
  }

  const { db } = await connectToDatabase();
  const injuries = await loadInjuries(db);

  // ── Time gate (dual-send: early + final) ──
  let sendType = null; // "early" or "final"
  if (!force && !dry) {
    if (lockout?.locked) return Response.json({ skipped: true, reason: "round already locked" });
    if (lockout && lockout.hoursUntil > NOTIFY_WINDOW_HOURS)
      return Response.json({ skipped: true, reason: `lockout ${Math.round(lockout.hoursUntil)}h away (>${NOTIFY_WINDOW_HOURS}h window)` });

    const isFinalWindow = lockout && lockout.minsUntil <= FINAL_WINDOW_MINS;
    sendType = isFinalWindow ? "final" : "early";

    const prevNotify = await getNotifyState(db, round);
    if (prevNotify) {
      if (sendType === "early" && prevNotify.early)
        return Response.json({ skipped: true, reason: `already sent early preview for round ${round}` });
      if (sendType === "final" && prevNotify.final)
        return Response.json({ skipped: true, reason: `already sent final update for round ${round}` });
    }
  } else {
    // force or dry — determine sendType for message display
    const isFinalWindow = lockout && lockout.minsUntil <= FINAL_WINDOW_MINS;
    sendType = isFinalWindow ? "final" : "early";
  }

  // ── Squad ──
  const squadDocs = await db.collection(`${YEAR}_squads`).find({ user_id: MY_USER, Active: 1 }).toArray();
  if (!squadDocs.length) return Response.json({ error: "No squad found" }, { status: 500 });

  // ── Stats ──
  const statsMap = await loadPlayerStats(db, squadDocs.map(p => p.player_name));
  const squad = squadDocs.map((p, idx) => {
    const s = statsMap[p.player_name];
    const scores = s ? (s.games ? scorePositionsFromGames(s.games) : scoreAllPositions(s.avg)) : {};
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return {
      name: p.player_name,
      team: p.team,
      scores,
      statsSource: s?.source || null,
      bestPos: best?.[0] || null,
      bestScore: best?.[1] || 0,
      squadIndex: idx,
    };
  });

  // ── Blend 2025 position scores when pre-season or data missing ──
  // Fetch 2025 scores if preteams=1 OR any squad player has no 2026 stats yet
  const need2025 = preteams || squad.some(p => Object.keys(p.scores).length === 0);
  if (need2025) {
    const scores2025ByName = await fetchSquad2025Scores();
    const BLEND_MAX = 10; // after 10 2026 games, fully trust 2026 data
    for (const p of squad) {
      const entry25 = scores2025ByName[(p.name || "").toLowerCase().trim()];
      if (!entry25) continue;
      // How many 2026 games does this player have? (parsed from statsSource "2026(5g)")
      const games2026 = (() => {
        const m = (statsMap[p.name]?.source || "").match(/2026\((\d+)g\)/);
        return m ? parseInt(m[1]) : 0;
      })();
      const w = Math.min(games2026, BLEND_MAX) / BLEND_MAX; // 0 = pure 2025, 1 = pure 2026
      const blended = {};
      for (const pos of MAIN_POSITIONS) {
        const s26 = p.scores[pos] ?? 0;
        const s25 = entry25.scores[pos] ?? 0;
        blended[pos] = Math.round((w * s26 + (1 - w) * s25) * 10) / 10;
      }
      p.scores = blended;
      p.statsSource = w === 0 ? `2025(${entry25.games}g)`
        : w >= 1             ? p.statsSource
        :                      `blend(${games2026}+${entry25.games}g)`;
      const best = Object.entries(blended).sort((a, b) => b[1] - a[1])[0];
      p.bestPos   = best?.[0] || null;
      p.bestScore = best?.[1] || 0;
    }
  }

  // ── Team selections + bye ──
  const roundFixtures = getRoundFixtures(fixtures, round);
  const playingTeams  = getPlayingTeams(roundFixtures);
  const byePlayers    = squad.filter(p => !teamIsPlaying(p.team, playingTeams));

  // Map each squad player to their team's fixture in this round, so we can
  // (a) skip auto-exclude for players whose match is days away and the AFL
  //     hasn't published the named22 yet, and
  // (b) flag the day of the match in the team-line of the Telegram message.
  const playerMatch = new Map();
  for (const p of squad) {
    for (const f of roundFixtures) {
      if (teamIsPlaying(p.team, new Set([f.HomeTeam, f.AwayTeam]))) {
        playerMatch.set(p.name, f); break;
      }
    }
  }
  const now = new Date();

  // "Played last round" set. AFL often publishes Sunday teams as just
  // "ins and outs" — if a player ran out last week and isn't on the outs
  // list (i.e. not marked as a multi-week injury), they're likely playing.
  let playedLastRound = new Set();
  if (round > 1) {
    try {
      const prev = await db.collection(`${YEAR}_game_results`)
        .find({ player_name: { $in: squad.map(p => p.name) }, round: round - 1 })
        .project({ player_name: 1, _id: 0 })
        .toArray();
      playedLastRound = new Set(prev.map(d => d.player_name));
    } catch (_) {}
  }

  const { selections: fwSelections, teamsFound } = await fetchAFLTeamSelections(round);
  const selectionStatus = fwSelections ? buildSelectionStatus(squad, fwSelections) : null;
  const effectiveSelectionStatus = preteams ? null : selectionStatus;

  // ── Re-check dedup (sendType already determined above) ──

  // ── Auto-exclude ──
  // Precedence:
  //  1. Bye → exclude
  //  2. Named in AFL 22 → INCLUDE (overrides stale injury data; "test" players
  //     often get named)
  //  3. MONTHS/SEASON injury → exclude
  //  4. WEEKS injury with lower-bound > 1 week → exclude (1-week / 1-2 week
  //     listings might still play; 2+ weeks definitely won't)
  //  5. AFL says "out" or "emergency" → exclude (with the "played-last-round
  //     and not multi-week-injured" backup so a stale ins/outs feed doesn't
  //     drop a healthy regular when the match is days away)
  const autoExcluded = new Set();
  for (const p of squad) {
    if (!teamIsPlaying(p.team, playingTeams)) { autoExcluded.add(p.name); continue; }

    const sel = effectiveSelectionStatus?.get(p.name);
    if (sel === "playing") continue;

    const sev = injSeverity(p.name, injuries);
    if (sev >= 3) { autoExcluded.add(p.name); continue; }
    if (sev === 2) {
      const inj = findInjury(p.name, injuries);
      if (injWeeksLower(inj?.detail) > 1) { autoExcluded.add(p.name); continue; }
    }

    if (effectiveSelectionStatus && (sel === "out" || sel === "emergency")) {
      const f = playerMatch.get(p.name);
      const hoursUntilMatch = f ? (new Date(f.DateUtc) - now) / 36e5 : 0;
      const matchImminent = hoursUntilMatch <= LATE_MATCH_THRESHOLD_HOURS;
      const likelyPlaying = playedLastRound.has(p.name) && sev < 2;
      if (matchImminent || !likelyPlaying) autoExcluded.add(p.name);
    }
  }

  // ── Lineup + tips ──
  // Joint optimisation of starters + bench (player AND backup position) + reserves.
  // The bench backup is chosen by expected value: the pairwise option value
  // E[(bench − starter)+] — which is naturally largest behind all-or-nothing
  // starters (MID/TAK style) — plus the bench's DNP margin over the reserve who
  // would otherwise cover, weighted by the starter's no-show risk.
  const result = optimiseLineup({
    squad,
    excluded: autoExcluded,
    statsMap,
    scoreFns: SCORE_FNS,
    positions: MAIN_POSITIONS,
    reserveACovers: RESERVE_A_COVERS,
    reserveBCovers: RESERVE_B_COVERS,
    riskOf: (p) =>
      (injSeverity(p.name, injuries) >= 1 || effectiveSelectionStatus?.get(p.name) === "emergency")
        ? DNP_RISK_FLAGGED
        : DNP_RISK_BASE,
  });
  const [squiggleResult, sportsbetOdds] = await Promise.all([
    fetchSquiggleTips(round),
    fetchSportsbetOdds(),
  ]);
  const { tips: squiggleTips, fetchError: squiggleFetchError } = squiggleResult;
  const tipSuggestions = buildTipSuggestions(roundFixtures, squiggleTips, sportsbetOdds);

  // Surface any Squiggle problem as an error so the cron routine fires its
  // warn-to-Telegram path. Two failure modes:
  //   1. fetchError: request to Squiggle failed (timeout / non-200 / parse) —
  //      every tip falls through to home-team 50%, silent until now.
  //   2. squiggleUnmatched: request succeeded but no candidates matched a
  //      fixture by name — always a dictionary bug.
  const squiggleUnmatched = tipSuggestions.filter(t => t.squiggleUnmatched);
  const errors = [];
  if (squiggleFetchError) errors.push(squiggleFetchError);
  if (squiggleUnmatched.length) {
    errors.push(`Squiggle name match failed for ${squiggleUnmatched.length}/${tipSuggestions.length} match(es) — update SQUIGGLE_TEAMS: ${squiggleUnmatched.map(t => `"${t.homeTeam}" v "${t.awayTeam}"`).join("; ")}`);
  }
  const squiggleError = errors.length ? errors.join(" | ") : null;
  if (squiggleError) console.error(squiggleError);

  // ── Save ──
  // Two commits per round, both before the round's first bounce:
  //   EARLY (~24h before first game): full save (team + tips).
  //   FINAL (~45m before first game, all teams out): full save again to pick
  //                                                  up late AFL team changes.
  // Server-side dedup (notify_state) prevents either window from firing twice.
  let savedTeam = false, savedTips = false;
  let tipsWritten = [], tipsPreserved = [];
  if (!dry) {
    try { await saveTeamSelection(db, round, result); savedTeam = true; } catch (_) {}
    try {
      const tipsToSave = Object.fromEntries(tipSuggestions.map(t => [t.matchNumber, { team: t.favourite, deadCert: !!t.suggestDC }]));
      const saveResult = await saveTips(db, round, tipsToSave);
      tipsWritten = saveResult.written;
      tipsPreserved = saveResult.preserved;
      savedTips = true;
    } catch (_) {}
  }

  // ── Send ──
  const isFinal = sendType === "final";
  const message = buildMessage({ round, lockout, result, autoExcluded, byePlayers, selectionStatus: effectiveSelectionStatus, tipSuggestions, savedTeam, savedTips, dry, injuries, isFinal, playerMatch, squad });
  let sent = false;
  if (!dry) {
    try { await sendTelegram(message); sent = true; } catch (e) { console.error("Telegram:", e.message); }
  }

  // ── Record ──
  if (!dry && !force && sent) await markRoundNotified(db, round, sendType);

  return Response.json({
    ok: !squiggleError, round, dry, teamsFound,
    autoExcluded: [...autoExcluded],
    byePlayers: byePlayers.map(p => p.name),
    savedTeam, savedTips, sent,
    tipsWritten, tipsPreserved,
    lineup: Object.fromEntries(MAIN_POSITIONS.map(pos => [pos, result.lineup[pos]?.name || null])),
    bench: result.bench ? {
      name: result.bench.name,
      backup: result.benchBackup,
      expectedGain: result.benchExpectedGain,
      options: (result.benchOptions || []).map(o => ({ pos: POS_SHORT[o.pos] || o.pos, gain: o.gain, value: o.value })),
    } : null,
    reserveA: result.reserveA?.name || null,
    reserveB: result.reserveB?.name || null,
    tips: tipSuggestions.map(t => ({ match: `${t.homeTeam} v ${t.awayTeam}`, tip: t.favourite, confidence: t.confidence, dc: !!t.suggestDC, homeOdds: t.homeOdds, awayOdds: t.awayOdds, source: t.source })),
    error: squiggleError || undefined,
    preview: dry ? message : undefined,
  });
}

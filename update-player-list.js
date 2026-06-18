'use strict';
/**
 * DuzzaTip 2026 — Direct AFL API → MongoDB player sync (CLI)
 *
 * The AFL API is the source of truth (it's where 2026_game_results stats come
 * from), so player names/teams must match it exactly. This script:
 *   1. Pulls every men's squad from the official AFL API
 *   2. Replaces the `2026_players` collection with the fresh roster
 *   3. Syncs team + provider_id on active rows in `2026_squads`
 *   4. Prints a diff (added / team-changed / removed) vs. what was in the DB
 *
 * AFL API is fetched via curl because Node's https is blocked by the local
 * Windows firewall (same pattern as lockout-notify.js). MongoDB is written
 * directly with the driver.
 *
 * Run: node update-player-list.js            (apply changes)
 *      node update-player-list.js --dry-run  (show diff, write nothing)
 */

require('dotenv').config({ path: '.env.local' });
const { execSync } = require('child_process');
const { MongoClient } = require('mongodb');

const COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership
const CURRENT_YEAR = new Date().getFullYear();
const DRY_RUN = process.argv.includes('--dry-run');

const MONGODB_URI = process.env.MONGODB_URI ||
  "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

const TEAM_ABBREV = {
  "Adelaide Crows":    "ADE",
  "Brisbane Lions":    "BRL",
  "Carlton":           "CAR",
  "Collingwood":       "COL",
  "Essendon":          "ESS",
  "Fremantle":         "FRE",
  "Geelong Cats":      "GEE",
  "Gold Coast SUNS":   "GCS",
  "GWS GIANTS":        "GWS",
  "Hawthorn":          "HAW",
  "Melbourne":         "MEL",
  "North Melbourne":   "NTH",
  "Port Adelaide":     "PTA",
  "Richmond":          "RIC",
  "St Kilda":          "STK",
  "Sydney Swans":      "SYD",
  "West Coast Eagles": "WCE",
  "Western Bulldogs":  "WBD",
};

function curl(url, opts = {}) {
  const headers = opts.headers || {};
  const headerArgs = Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(' ');
  const method = opts.method ? `-X ${opts.method}` : '';
  const body = opts.body ? `-d '${opts.body}'` : '';
  const cmd = `curl -s ${method} "${url}" ${headerArgs} ${body}`;
  const out = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
  return JSON.parse(out);
}

async function fetchAflRoster() {
  console.log('Fetching AFL API token...');
  const tok = curl('https://api.afl.com.au/cfs/afl/WMCTok', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.afl.com.au' },
    body: '{}',
  });
  const hdrs = { 'x-media-mis-token': tok.token };

  console.log('Fetching teams...');
  const teamsData = curl('https://aflapi.afl.com.au/afl/v2/teams?pageSize=50', { headers: hdrs });
  const menTeams = teamsData.teams.filter(t => t.teamType === 'MEN');
  console.log(`Found ${menTeams.length} men's teams\n`);

  const allPlayers = [];
  for (const team of menTeams) {
    const englishName = team.club?.name || team.name;
    const abbrev = TEAM_ABBREV[englishName] || team.abbreviation;
    process.stdout.write(`  ${abbrev}...`);
    const data = curl(
      `https://aflapi.afl.com.au/afl/v2/squads?teamId=${team.id}&compSeasonId=${COMP_SEASON_ID}&pageSize=1000`,
      { headers: hdrs }
    );
    const players = data.squad?.players || [];
    for (const p of players) {
      allPlayers.push({
        player_name: `${p.player.firstName} ${p.player.surname}`,
        team_name: abbrev,
        afl_id: p.player.id,
        provider_id: p.player.providerId,
      });
    }
    process.stdout.write(` ${players.length}\n`);
  }
  console.log(`\nTotal players from API: ${allPlayers.length}`);
  return allPlayers;
}

async function main() {
  const allPlayers = await fetchAflRoster();

  console.log(DRY_RUN ? '\n[DRY RUN] Connecting to MongoDB (read-only)...' : '\nConnecting to MongoDB...');
  const client = new MongoClient(MONGODB_URI, { connectTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('afl_database');
  console.log('Connected.');

  const playersCol = db.collection(`${CURRENT_YEAR}_players`);
  const squadsCol = db.collection(`${CURRENT_YEAR}_squads`);

  // ── Diff vs. what's currently in 2026_players ──────────────────────────────
  const existing = await playersCol.find({}).toArray();
  const oldMap = new Map(existing.map(p => [p.player_name, p.team_name]));
  const newMap = new Map(allPlayers.map(p => [p.player_name, p.team_name]));

  const added = [], removed = [], teamChanged = [];
  for (const [name, team] of newMap) {
    if (!oldMap.has(name)) added.push({ name, team });
    else if (oldMap.get(name) !== team) teamChanged.push({ name, from: oldMap.get(name), to: team });
  }
  for (const [name, team] of oldMap) {
    if (!newMap.has(name)) removed.push({ name, team });
  }

  console.log('\n=== CHANGES vs 2026_players ===');
  if (added.length) {
    console.log(`\n+ ADDED (${added.length}):`);
    added.sort((a, b) => a.name.localeCompare(b.name)).forEach(p => console.log(`  + ${p.name} (${p.team})`));
  }
  if (teamChanged.length) {
    console.log(`\n~ TEAM CHANGED (${teamChanged.length}):`);
    teamChanged.forEach(p => console.log(`  ~ ${p.name}: ${p.from} -> ${p.to}`));
  }
  if (removed.length) {
    console.log(`\n- REMOVED (${removed.length}):`);
    removed.forEach(p => console.log(`  - ${p.name} (${p.team})`));
  }
  if (!added.length && !teamChanged.length && !removed.length) console.log('No changes.');

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No writes performed.');
    await client.close();
    return;
  }

  // ── Replace 2026_players with the fresh roster ─────────────────────────────
  await playersCol.deleteMany({});
  const ins = await playersCol.insertMany(
    allPlayers.map(p => ({
      player_id: p.provider_id || `afl-${p.afl_id}`,
      player_name: p.player_name,
      team_name: p.team_name,
    }))
  );
  console.log(`\n2026_players: replaced with ${ins.insertedCount} players.`);

  // ── Sync team + provider_id on active squad rows ───────────────────────────
  const playerByNameTeam = {};
  const playerByName = {};
  for (const p of allPlayers) {
    playerByNameTeam[`${p.player_name}|${p.team_name}`] = p;
    (playerByName[p.player_name] ||= []).push(p);
  }

  const activeSquad = await squadsCol.find({ Active: 1 }).toArray();
  const teamUpdates = [], idUpdates = [];
  for (const sq of activeSquad) {
    const byNameTeam = playerByNameTeam[`${sq.player_name}|${sq.team}`];
    const byName = playerByName[sq.player_name];
    const afl = byNameTeam || (byName?.length === 1 ? byName[0] : null);
    if (!afl) continue;

    const updates = {};
    if (afl.team_name !== sq.team) {
      updates.team = afl.team_name;
      teamUpdates.push(`${sq.player_name}: ${sq.team} -> ${afl.team_name}`);
    }
    if (afl.provider_id && sq.provider_id !== afl.provider_id) {
      updates.provider_id = afl.provider_id;
      updates.afl_id = afl.afl_id;
      idUpdates.push(sq.player_name);
    }
    if (Object.keys(updates).length) {
      await squadsCol.updateMany(
        { player_name: sq.player_name, user_id: sq.user_id },
        { $set: updates }
      );
    }
  }

  console.log(`2026_squads: ${teamUpdates.length} team updates, ${idUpdates.length} provider_id updates.`);
  if (teamUpdates.length) teamUpdates.forEach(u => console.log(`  ~ ${u}`));

  await client.close();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });

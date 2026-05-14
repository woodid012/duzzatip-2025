// Audit 2026 Dead Cert opportunities for User 4 vs the ≥67% rule.
require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");
const axios = require("axios");

const MY_USER = 4;
const YEAR = 2026;
const WIN = 6, LOSS = -12;

// See lockout-notify.js for why a strict alias map is needed (GWS / Bulldogs / etc.).
const TEAM_ID = {
  "adelaide": "adelaide", "adelaide crows": "adelaide", "crows": "adelaide",
  "brisbane": "brisbane", "brisbane lions": "brisbane", "lions": "brisbane",
  "carlton": "carlton", "blues": "carlton",
  "collingwood": "collingwood", "magpies": "collingwood", "pies": "collingwood",
  "essendon": "essendon", "bombers": "essendon", "dons": "essendon",
  "fremantle": "fremantle", "dockers": "fremantle", "freo": "fremantle",
  "geelong": "geelong", "geelong cats": "geelong", "cats": "geelong",
  "gold coast": "gold-coast", "gold coast suns": "gold-coast", "suns": "gold-coast",
  "gws": "gws", "gws giants": "gws", "greater western sydney": "gws", "giants": "gws",
  "hawthorn": "hawthorn", "hawks": "hawthorn",
  "melbourne": "melbourne", "demons": "melbourne", "dees": "melbourne",
  "north melbourne": "north-melbourne", "north": "north-melbourne", "kangaroos": "north-melbourne", "roos": "north-melbourne",
  "port adelaide": "port-adelaide", "port": "port-adelaide", "power": "port-adelaide",
  "richmond": "richmond", "tigers": "richmond",
  "st kilda": "st-kilda", "saints": "st-kilda",
  "sydney": "sydney", "sydney swans": "sydney", "swans": "sydney",
  "west coast": "west-coast", "west coast eagles": "west-coast", "eagles": "west-coast",
  "western bulldogs": "western-bulldogs", "bulldogs": "western-bulldogs", "footscray": "western-bulldogs",
};
function teamId(name) {
  return name ? TEAM_ID[name.toLowerCase().trim()] || null : null;
}

function aggHomePct(squig, h, a) {
  const hId = teamId(h), aId = teamId(a);
  const c = squig.filter(t =>
    hId && aId && teamId(t.hteam) === hId && teamId(t.ateam) === aId
  );
  if (!c.length) return null;
  return c.reduce((s, t) => {
    const hc = parseFloat(t.hconfidence);
    if (!Number.isNaN(hc)) return s + hc;
    const cc = parseFloat(t.confidence);
    if (Number.isNaN(cc)) return s + 50;
    // Compare t.tip to t.hteam (Squiggle's own naming); see backtest-dc.js note.
    return s + (t.tip === t.hteam ? cc : 100 - cc);
  }, 0) / c.length;
}

(async () => {
  const cl = new MongoClient(process.env.MONGODB_URI);
  await cl.connect();
  const db = cl.db("afl_database");

  const myTips = await db.collection(`${YEAR}_tips`).find({ User: MY_USER, Active: 1 }).toArray();
  const fixtures = await db.collection(`${YEAR}_fixtures`).find({}).toArray();
  const fixByMatch = {};
  for (const f of fixtures) fixByMatch[`${f.RoundNumber}-${f.MatchNumber}`] = f;

  const rounds = [...new Set(myTips.map(t => t.Round))].sort((a, b) => a - b);
  console.log(`Auditing ${rounds.length} rounds: ${rounds.join(", ")}\n`);

  let actualNet = 0, simNet = 0;
  let actualW = 0, actualL = 0, simW = 0, simL = 0;
  let missedOpps = 0, totalActualDC = 0, totalSimDC = 0;

  for (const round of rounds) {
    let squig = [];
    try {
      const r = await axios.get(`https://api.squiggle.com.au/?q=tips;year=${YEAR};round=${round}`,
        { timeout: 15000, headers: { "User-Agent": "duzzatip-audit" } });
      squig = r.data?.tips || [];
    } catch (e) {
      console.log(`R${round}: squiggle fetch failed (${e.message}) — skipping`);
      continue;
    }

    const tipsThisRound = myTips.filter(t => t.Round === round);
    console.log(`=== Round ${round} ===`);

    const rows = [];
    for (const tip of tipsThisRound) {
      const f = fixByMatch[`${round}-${tip.MatchNumber}`];
      if (!f) continue;
      const hp = aggHomePct(squig, f.HomeTeam, f.AwayTeam);
      if (hp === null) continue;
      const fav = hp >= 50 ? f.HomeTeam : f.AwayTeam;
      const conf = Math.round(Math.max(hp, 100 - hp));
      const hasResult = f.HomeTeamScore != null && f.AwayTeamScore != null;
      const winner = hasResult ? (f.HomeTeamScore > f.AwayTeamScore ? f.HomeTeam : f.AwayTeam) : null;
      rows.push({
        match: tip.MatchNumber,
        home: f.HomeTeam,
        away: f.AwayTeam,
        tipped: tip.Team,
        fav,
        conf,
        winner,
        hasResult,
        actualDC: tip.DeadCert,
        wouldDC: conf >= 67,
      });
    }

    for (const r of rows) {
      const flag = r.hasResult ? (r.tipped === r.winner ? "✓" : "✗") : "·";
      const dcMarker = r.actualDC ? "[DC]" : "    ";
      const wouldMarker = r.wouldDC ? "→DC" : "   ";
      console.log(`  ${flag} ${dcMarker} ${r.tipped.padEnd(20)} (${String(r.conf).padStart(2)}%) ${wouldMarker}`);

      if (r.hasResult) {
        if (r.actualDC) {
          if (r.tipped === r.winner) { actualNet += WIN; actualW++; }
          else { actualNet += LOSS; actualL++; }
        }
        if (r.wouldDC) {
          if (r.fav === r.winner) { simNet += WIN; simW++; }
          else { simNet += LOSS; simL++; }
          if (!r.actualDC) missedOpps++;
        }
      }
      if (r.actualDC) totalActualDC++;
      if (r.wouldDC) totalSimDC++;
    }
    console.log("");
    await new Promise(r => setTimeout(r, 400));
  }

  console.log("========== SUMMARY ==========");
  console.log(`Actual DCs you set:      ${totalActualDC}  (${actualW}W ${actualL}L → ${actualNet >= 0 ? "+" : ""}${actualNet} pts)`);
  console.log(`≥67% rule would set:     ${totalSimDC}  (${simW}W ${simL}L → ${simNet >= 0 ? "+" : ""}${simNet} pts)`);
  console.log(`Opportunities missed:    ${missedOpps}`);
  console.log(`Net difference:          ${simNet - actualNet >= 0 ? "+" : ""}${simNet - actualNet} pts`);

  await cl.close();
})().catch(e => { console.error(e); process.exit(1); });

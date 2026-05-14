// Backtest dead-cert thresholds against 2024 + 2025 results.
// Uses Squiggle aggregate confidence (the script's primary source, mirrors lockout-notify.js).
require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");
const axios = require("axios");

const YEARS = [2024, 2025];
const WIN_PTS = 6, LOSS_PTS = -12;

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

function aggHomePct(squiggleTips, homeTeam, awayTeam) {
  const hId = teamId(homeTeam), aId = teamId(awayTeam);
  const cands = squiggleTips.filter(t =>
    hId && aId && teamId(t.hteam) === hId && teamId(t.ateam) === aId
  );
  if (!cands.length) return null;
  const sum = cands.reduce((a, t) => {
    const h = parseFloat(t.hconfidence);
    if (!Number.isNaN(h)) return a + h;
    const c = parseFloat(t.confidence);
    if (Number.isNaN(c)) return a + 50;
    // Compare t.tip to t.hteam (Squiggle's own naming) — comparing to homeTeam
    // (fixture naming) flips orientation for teams whose Squiggle short name
    // differs from the fixture name (e.g. "Sydney" vs "Sydney Swans").
    return a + (t.tip === t.hteam ? c : 100 - c);
  }, 0);
  return sum / cands.length;
}

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("afl_database");

  // Build dataset: { year, round, home, away, homePct, confidence, tippedHome, winner }
  const dataset = [];

  for (const year of YEARS) {
    const fixtures = await db.collection(`${year}_fixtures`).find({
      HomeTeamScore: { $ne: null },
      AwayTeamScore: { $ne: null },
    }).toArray();

    const rounds = [...new Set(fixtures.map(f => f.RoundNumber))].sort((a, b) => a - b);
    process.stdout.write(`${year}: fetching ${rounds.length} rounds`);

    for (const round of rounds) {
      let squig = [];
      try {
        const res = await axios.get(
          `https://api.squiggle.com.au/?q=tips;year=${year};round=${round}`,
          { headers: { "User-Agent": "duzzatip-backtest" }, timeout: 15000 }
        );
        squig = res.data?.tips || [];
      } catch (e) {
        process.stdout.write(`!`);
        continue;
      }
      process.stdout.write(".");

      for (const f of fixtures.filter(x => x.RoundNumber === round)) {
        const hScore = f.HomeTeamScore, aScore = f.AwayTeamScore;
        if (hScore === aScore) continue; // skip draws — push under most rules
        const winner = hScore > aScore ? f.HomeTeam : f.AwayTeam;
        const hp = aggHomePct(squig, f.HomeTeam, f.AwayTeam);
        if (hp === null) continue;
        const tipHome = hp >= 50;
        const tippedTeam = tipHome ? f.HomeTeam : f.AwayTeam;
        const conf = Math.max(hp, 100 - hp);
        dataset.push({
          year, round,
          home: f.HomeTeam, away: f.AwayTeam,
          confidence: conf,
          tippedTeam,
          winner,
          correct: tippedTeam === winner,
        });
      }
      // Be polite to Squiggle
      await new Promise(r => setTimeout(r, 350));
    }
    process.stdout.write("\n");
  }

  console.log(`\nTotal matches with confidence + result: ${dataset.length}`);

  // Threshold sweep
  const thresholds = [];
  for (let t = 50; t <= 95; t += 1) thresholds.push(t);

  console.log("\nThreshold | Picks | Wins | Losses | Win% | Net pts | Pts/pick");
  console.log("----------|-------|------|--------|------|---------|---------");
  for (const th of thresholds) {
    const picks = dataset.filter(d => d.confidence >= th);
    const wins = picks.filter(d => d.correct).length;
    const losses = picks.length - wins;
    const net = wins * WIN_PTS + losses * LOSS_PTS;
    const winPct = picks.length ? (wins / picks.length * 100).toFixed(1) : "—";
    const ppp = picks.length ? (net / picks.length).toFixed(2) : "—";
    if (th % 5 === 0 || th === 67) {
      console.log(
        `   ${String(th).padStart(2)}%    | ${String(picks.length).padStart(5)} | ${String(wins).padStart(4)} | ${String(losses).padStart(6)} | ${winPct.padStart(4)} | ${String(net).padStart(7)} | ${ppp.padStart(7)}`
      );
    }
  }

  // Optimal threshold
  let best = { th: null, net: -Infinity };
  for (const th of thresholds) {
    const picks = dataset.filter(d => d.confidence >= th);
    const wins = picks.filter(d => d.correct).length;
    const net = wins * WIN_PTS + (picks.length - wins) * LOSS_PTS;
    if (net > best.net) best = { th, net, picks: picks.length, wins };
  }
  console.log(`\nOptimal: ≥${best.th}% → ${best.picks} picks, ${best.wins} wins, NET ${best.net} pts`);

  // Bin-by-bin observed accuracy
  console.log("\nObserved accuracy by confidence bin:");
  console.log("Bin       | N   | Wins | Win% | EV/pick");
  console.log("----------|-----|------|------|--------");
  const bins = [[50,60],[60,67],[67,70],[70,75],[75,80],[80,85],[85,90],[90,101]];
  for (const [lo, hi] of bins) {
    const picks = dataset.filter(d => d.confidence >= lo && d.confidence < hi);
    const wins = picks.filter(d => d.correct).length;
    const winPct = picks.length ? (wins / picks.length * 100).toFixed(1) : "—";
    const ev = picks.length ? ((wins * WIN_PTS + (picks.length - wins) * LOSS_PTS) / picks.length).toFixed(2) : "—";
    console.log(`${String(lo).padStart(3)}-${String(hi - 1).padStart(3)}%  | ${String(picks.length).padStart(3)} | ${String(wins).padStart(4)} | ${winPct.padStart(4)} | ${ev.padStart(6)}`);
  }

  await client.close();
})().catch(e => { console.error(e); process.exit(1); });

// scripts/repair-future-fixture-scores.js
//
// One-off / safe-to-rerun repair for fixture rows that carry a score for a
// game that has not actually been played yet.
//
// Background: the AFL score overlay used to key scores by team matchup alone
// (home|away), dropping the round. When the same matchup recurs in two rounds
// (e.g. Hawthorn v Western Bulldogs plays in both round 5 and round 13 of
// 2026), the earlier round's final score could leak onto the later round's
// fixture and get written back to MongoDB. The overlay code has since been
// fixed to key by round, but already-corrupted rows persist until their real
// game concludes.
//
// A fixture whose DateUtc is still in the future cannot legitimately have a
// result, so any score on such a row is corruption. This script nulls those
// out so the (now round-correct) overlay refills them properly once the game
// is actually played.
//
// Usage:
//   MONGODB_URI='...' node src/app/scripts/repair-future-fixture-scores.js          # dry run (default)
//   MONGODB_URI='...' node src/app/scripts/repair-future-fixture-scores.js --apply  # actually write
//   MONGODB_URI='...' node src/app/scripts/repair-future-fixture-scores.js --year 2026 --apply

const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const yearArgIdx = process.argv.indexOf('--year');
const YEAR = yearArgIdx !== -1 ? parseInt(process.argv[yearArgIdx + 1]) : new Date().getFullYear();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Please set the MONGODB_URI environment variable.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db('afl_database');
    const col = db.collection(`${YEAR}_fixtures`);
    const now = new Date();

    // Future-dated fixtures that nonetheless carry a score → corruption.
    const all = await col.find({}).toArray();
    const corrupt = all.filter(f =>
      new Date(f.DateUtc) > now &&
      (f.HomeTeamScore !== null || f.AwayTeamScore !== null)
    );

    if (corrupt.length === 0) {
      console.log(`No corrupted future-dated fixtures found for ${YEAR}. Nothing to repair.`);
      return;
    }

    console.log(`Found ${corrupt.length} future-dated fixture(s) with a score (${YEAR}):`);
    for (const f of corrupt) {
      console.log(
        `  Round ${f.RoundNumber}  Match ${f.MatchNumber}  ` +
        `${f.HomeTeam} ${f.HomeTeamScore} v ${f.AwayTeamScore} ${f.AwayTeam}  ` +
        `(starts ${f.DateUtc})`
      );
    }

    if (!APPLY) {
      console.log('\nDry run — no changes written. Re-run with --apply to clear these scores.');
      return;
    }

    const res = await col.updateMany(
      {
        MatchNumber: { $in: corrupt.map(f => f.MatchNumber) },
        year: YEAR,
      },
      { $set: { HomeTeamScore: null, AwayTeamScore: null } }
    );
    console.log(`\nCleared scores on ${res.modifiedCount} fixture(s). They will refill correctly once each game is played.`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});

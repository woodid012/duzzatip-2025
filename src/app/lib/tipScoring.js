// Tip scoring — the one rule for how a Tip scores against an AFL fixture.
//
// - A match is complete once both scores are non-null; an incomplete match
//   is unscored (correct: null).
// - The winner is the higher-scoring team, or the literal 'Draw', which no
//   tip can equal — so a Draw is never a correct tip.
// - No tip ⇒ the home team is tipped (isDefault: true), never a dead cert.
// - Dead cert: +6 if correct, −12 if wrong. A plain correct tip adds 0 to
//   the dead cert score (it counts toward correctTips only).

export function isMatchComplete(fixture) {
  return fixture.HomeTeamScore !== null && fixture.AwayTeamScore !== null;
}

export function matchWinner(fixture) {
  if (fixture.HomeTeamScore > fixture.AwayTeamScore) return fixture.HomeTeam;
  if (fixture.AwayTeamScore > fixture.HomeTeamScore) return fixture.AwayTeam;
  return 'Draw';
}

// Scores one Tip ({ Team, DeadCert } or undefined) against its fixture.
export function scoreTip(fixture, tip) {
  const isCompleted = isMatchComplete(fixture);
  const tipTeam = tip ? tip.Team : fixture.HomeTeam;
  return {
    matchNumber: fixture.MatchNumber,
    homeTeam: fixture.HomeTeam,
    awayTeam: fixture.AwayTeam,
    homeScore: fixture.HomeTeamScore,
    awayScore: fixture.AwayTeamScore,
    tip: tipTeam,
    deadCert: tip ? tip.DeadCert : false,
    correct: isCompleted ? tipTeam === matchWinner(fixture) : null,
    isDefault: !tip,
    isCompleted,
  };
}

// Totals scored tips ({ correct, deadCert }). Unscored rows (correct: null)
// count for nothing.
export function totalTips(scoredTips) {
  let correctTips = 0;
  let deadCertScore = 0;
  let correctDeadCerts = 0;
  let wrongDeadCerts = 0;

  for (const m of scoredTips) {
    if (m.correct === null) continue;
    if (m.correct) {
      correctTips++;
      if (m.deadCert) {
        deadCertScore += 6;
        correctDeadCerts++;
      }
    } else if (m.deadCert) {
      deadCertScore -= 12;
      wrongDeadCerts++;
    }
  }

  return { correctTips, deadCertScore, correctDeadCerts, wrongDeadCerts };
}

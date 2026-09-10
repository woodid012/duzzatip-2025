This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Seasonal Maintenance

Run these **before each season** and **after every mid-season draft** (the AFL
adds new players to club squads at both points). The AFL API is the source of
truth — it's where `2026_game_results` stats come from — so the selectable
player list must match it.

### Refresh the player list

```bash
node update-player-list.js            # apply: AFL API -> 2026_players + sync 2026_squads
node update-player-list.js --dry-run  # preview the diff, write nothing
```

This pulls every men's squad from the official AFL API, replaces the
`2026_players` collection, and backfills `team` + `provider_id` on active
`2026_squads` rows. It prints a diff of added / team-changed / removed players
so you can sanity-check the mid-season intake before anyone drafts. (The
`/api/update-players` route does the same thing server-side if you'd rather hit
the deployed app.)

## Dead Cert Threshold — 2025 Backtest

Dead Cert scoring: **+6** correct, **−12** wrong → theoretical break-even at **p = 12/18 = 66.7%**.

`lockout-notify.js` flags every match with Squiggle aggregate confidence **≥ 67%** as a suggested Dead Cert. The backtest below replays the 2025 H&A season (189 matches with both a Squiggle confidence and a final result) to validate that threshold.

### Threshold sweep

| Threshold | Picks | Win% | Net pts | Pts/pick |
|-----------|-------|------|---------|----------|
| ≥50%      | 189   | 75.7 | +306    | 1.62     |
| ≥60%      | 133   | 80.5 | +330    | 2.48     |
| ≥65%      | 104   | 85.6 | +354    | 3.40     |
| **≥67%**  | **95** | **87.4** | **+354** | **3.73** |
| ≥70%      | 79    | 88.6 | +312    | 3.95     |
| ≥75%      | 57    | 91.2 | +252    | 4.42     |
| ≥80%      | 38    | 94.7 | +192    | 5.05     |
| ≥85%      | 19    | 100.0 | +114    | 6.00     |
| ≥90%      | 9     | 100.0 | +54     | 6.00     |

**Optimal threshold:** ≥64% → +378 net pts (only +24 better than ≥67% — a wash).

### Calibration: observed accuracy by confidence bin

| Squiggle bin | N  | Actual win% | EV/pick |
|--------------|----|-------------|---------|
| 50–59%       | 56 | 64.3        | **−0.43** |
| 60–66%       | 38 | 63.2        | **−0.63** |
| 67–69%       | 16 | 81.3        | +2.63   |
| 70–74%       | 22 | 81.8        | +2.73   |
| 75–79%       | 19 | 84.2        | +3.16   |
| 80–84%       | 19 | 89.5        | +4.11   |
| 85–89%       | 10 | 100.0       | +6.00   |
| 90–100%      | 9  | 100.0       | +6.00   |

### Takeaways

1. **Squiggle is well-calibrated above 67%** — every bin from 67% up has positive EV.
2. **The 60–66% band is a trap.** It looks close to break-even but only converted 63% of the time in 2025 — slightly worse than the 66.7% you need.
3. **The current ≥67% setting is essentially optimal** — 87 wins / 12 losses out of 95 dead certs across the 2025 season for **+354 net points**.
4. **Zero-risk option:** ≥85% never lost a game in 2025 (19/19), but you'd only flag ~1 match per round.

Re-run the backtest at any time with `node backtest-dc.js` (uses the same MongoDB data + Squiggle API).

## Opponent Weighting (Duzza Finals) — 2024–26 Backtest

`lockout-notify.js` can scale each finals candidate's projected score by how many points their opponent has conceded at that position recently (`buildOpponentMultipliers` in `src/app/lib/duzzaFinalsAutoPick.js`; knobs `OPP_WINDOW` / `OPP_SHRINK`). Backtested 10 Sept 2026 over every round of 2024, 2025 and 2026 (63 rounds). Metric: actual points scored by the top-projected player at each of the 6 positions, per round.

### Grid result (best of 16 configs, chosen on the same data)

| Config | 2024 | 2025 | 2026 | Pooled |
|--------|------|------|------|--------|
| baseline | 192.9 | 222.1 | 196.5 | 202.9 |
| window 4, shrink 0.5 | +3.7 | +0.8 | +2.4 | +2.4 |

### Robustness checks (window 4, shrink 0.5)

| Check | Result | Verdict |
|-------|--------|---------|
| Paired test, 63 rounds | mean +2.4, SD 23.9, 31/63 wins, p = 0.16, 95% CI [−3.4, +8.2] | inconclusive |
| Leave-one-year-out | held-out deltas +3.7 / −9.4 / −3.4, mean −3.1 | no |
| Placebo (20 label shuffles) | placebo mean −3.3; real beats all 20 | weak yes |
| Finals rounds only (6 rounds) | mean −8.8 | no |
| Rounds ≥ 20 (21 rounds) | mean −4.0 | no |

### Takeaways

1. **The +2.4 is selection noise.** It was picked from 16 configs on the data it was scored on. Choose the config on two years and test on the third and the sign flips.
2. **It hurts in the rounds where it is used.** Finals-only and late-season samples are both negative.
3. **The signal is too small for the data.** Per-round swing is ~24 pts; the effect sought is ~2 pts. Three seasons cannot resolve that.
4. **Recommendation: leave it off** (`OPP_SHRINK=0`) unless a future season with more finals data changes the picture. The placebo only shows random weights hurt more than real ones, not that real ones help.
5. **Retest before trusting a new idea here:** any tweak to the conceded-points metric (e.g. top-N per match instead of mean per player-row) must beat the leave-one-year-out and finals-only checks, not just the pooled grid.

Re-run with `node backtest-opponent-weights.js` (grid) or `node backtest-opponent-weights.js --robust` (the checks above).

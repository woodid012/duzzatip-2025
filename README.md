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

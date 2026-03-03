# DuzzaTip Lockout Notifier — OpenClaw Brief

## Architecture

```
openclaw (Hostinger)
  → polls Footywire every 15-20 min (Wed evening → Thu evening AEST)
  → detects AFL team selections announced
  → POST https://duzzatip.vercel.app/api/lockout-notify?token=<NOTIFY_SECRET>
      → Vercel computes optimal team + tips
      → saves to MongoDB
      → sends Telegram message to user (@woodenduck_bot → chat_id 8600335192)
```

## The API endpoint

**Base URL:** `https://duzzatip.vercel.app/api/lockout-notify`

### Auth
Every request needs the secret from Vercel env var `NOTIFY_SECRET`:
```
Authorization: Bearer <NOTIFY_SECRET>
```
or as a query param: `?token=<NOTIFY_SECRET>`

### Endpoints

| Method | URL | What it does |
|--------|-----|--------------|
| GET/POST | `/api/lockout-notify` | Run full notify (gates on 36h + dedup) |
| GET/POST | `/api/lockout-notify?force=1` | Run immediately, skip gates |
| GET/POST | `/api/lockout-notify?dry=1` | Compute only, no save/send — returns preview in JSON |
| GET | `/api/lockout-notify?probe=1` | Check if teams announced — lightweight, no compute |

### Probe response (use this for polling)
```json
{
  "round": 1,
  "teamsFound": 16,
  "ppCount": 418,
  "announced": true,
  "lockout": { "melbTime": "Thu, 12 Mar, 7:30 pm", "hoursUntil": 8, "locked": false }
}
```
- `announced: true` when `teamsFound >= 10`
- `ppCount` = raw count of player links on the page (< 50 = not out yet, > 200 = announced)

### Trigger response
```json
{
  "ok": true,
  "round": 1,
  "teamsFound": 18,
  "autoExcluded": ["Kelly, Josh", "Draper, Sam"],
  "byePlayers": [],
  "savedTeam": true,
  "savedTips": true,
  "sent": true,
  "lineup": { "Full Forward": "Aaron Naughton", "Midfielder": "Bailey Smith", ... },
  "tips": [{ "match": "Carlton v Richmond", "tip": "Carlton", "confidence": 71, "dc": false }, ...]
}
```

## Your monitoring job

### When to poll
- **Window:** Wednesday 5pm AEST → Thursday 8pm AEST each week
- **Frequency:** every 15–20 minutes within that window
- **Outside the window:** no need to poll (teams aren't announced Mon–Wed afternoon)

### Decision logic
```
1. GET /api/lockout-notify?probe=1&token=<secret>
2. If announced == true AND lockout.locked == false:
     POST /api/lockout-notify?token=<secret>
     → stop polling for this round (the API deduplicates but no need to keep hitting it)
3. If announced == false: wait 20 min, try again
4. If lockout.locked == true: stop polling (too late)
```

### One-off manual trigger
If the user asks you to send the brief now:
```
POST https://duzzatip.vercel.app/api/lockout-notify?force=1&token=<NOTIFY_SECRET>
```

## What the user receives

A Telegram message from @woodenduck_bot with:
- Round + lockout countdown
- 9-slot team (FF/TF/OFF/MID/TAK/RUC/Bench/Res A/Res B) + projected pts
- Alerts: 🚫 bye players, ✗ not named, ⚡ emergencies, ⚠ injury doubts
- All round tips with win% and 💀DC suggestion
- "✅ Team + tips saved" confirmation

## Vercel env vars needed
Make sure these are set in the Vercel dashboard:
- `MONGODB_URI` — already set (app uses it)
- `TELEGRAM_BOT_TOKEN` — bot token for @woodenduck_bot
- `NOTIFY_SECRET` — any strong random string, used to auth openclaw's requests

---

## DuzzaTip Scoring System (so you can reason about lineup choices)

### The 9-slot roster
| Slot | Abbr | Covers |
|------|------|--------|
| Full Forward | FF | Main slot |
| Tall Forward | TF | Main slot |
| Offensive | OFF | Main slot |
| Midfielder | MID | Main slot |
| Tackler | TAK | Main slot |
| Ruck | RUC | Main slot |
| Bench | — | Backs up 1 specified position (always plays) |
| Reserve A | ResA | Covers FF/TF/RUC — only activates if that player DNP |
| Reserve B | ResB | Covers OFF/MID/TAK — only activates if that player DNP |

### Scoring formulas (avg stats per game → fantasy points)
```
FF  = Goals × 9 + Behinds × 1
TF  = Goals × 6 + Marks × 2
OFF = Goals × 7 + Kicks × 1
MID = min(Disposals, 30) × 1 + max(0, Disposals−30) × 3
      (Disposals = Kicks + Handballs; capped at 30, extras worth 3x)
TAK = Tackles × 4 + Handballs × 1
RUC = Hitouts + Marks (if total ≤ 18)
    = Hitouts + regularMarks + bonusMarks × 3 (if total > 18)
      (regularMarks = max(0, 18 − Hitouts), bonusMarks = remaining marks)
```

### Optimal lineup algorithm (greedy max-margin)
The system assigns positions one at a time, always filling the position where
the best available player has the BIGGEST advantage over the second-best player.
This ensures star players lock in their most impactful position first.

Example: If your best goal-kicker scores 35 as FF but only 20 as OFF, and
the next-best FF scorer is 22, the margin is 13. That FF spot is assigned first.

### What makes a good Reserve pick
- **Reserve A** (FF/TF/RUC backup): pick a player who scores well as a forward or ruck.
  They only play if the main FF, TF, or RUC player is DNP (did not play / unnamed).
- **Reserve B** (OFF/MID/TAK backup): pick a high-disposal mid or tackling player.
  They only play if the main OFF, MID, or TAK player is DNP.

### Player evaluation tips
- **FF specialists**: high goal kickers (5+ goals avg = ~45 FF pts)
- **TF specialists**: tall forwards who also mark a lot (7-10 marks + 2-3 goals)
- **OFF specialists**: forwards with high kick counts but moderate goals
- **MID monsters**: 30+ disposals; every disposal over 30 is worth 3x
- **TAK beasts**: 8+ tackles/game is elite; handballs are bonus
- **RUC dominants**: 40+ hitouts or strong marking rucks with 18+ combined get bonus

---

## What the user might ask you to do
- "Trigger my DuzzaTip brief now" → POST to the force URL above
- "Check if teams are out" → GET the probe URL
- "What round is it?" → probe response includes round + lockout info
- "Did my team get saved?" → trigger response includes savedTeam/savedTips
- "Send me the player stats / position report" or "how does my squad rank by position?" →
  `POST https://duzzatip.vercel.app/api/stats-report?send=1&token=<NOTIFY_SECRET>`
  This sends a multi-message Telegram breakdown of your squad's 2025 position scores.
  Add `&league=1` to also see league-wide top players per position.
  Add `&pos=MID` to filter to a single position (FF/TF/OFF/MID/TAK/RUC).
  Add `&format=text` to get plain text response instead of JSON.

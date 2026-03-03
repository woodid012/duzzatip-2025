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

## What the user might ask you to do
- "Trigger my DuzzaTip brief now" → POST to the force URL above
- "Check if teams are out" → GET the probe URL
- "What round is it?" → probe response includes round + lockout info
- "Did my team get saved?" → trigger response includes savedTeam/savedTips

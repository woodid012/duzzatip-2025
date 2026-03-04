# DuzzaTip Lockout Notifier — OpenClaw Brief

## Architecture

```
openclaw (Hostinger)
  → polls https://www.afl.com.au/matches/team-lineups (day before first match, from ~5pm AEST)
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
  "allTeams": false,
  "lockout": { "melbTime": "Thu, 12 Mar, 7:30 pm", "hoursUntil": 8, "locked": false }
}
```
- `announced: true` when `teamsFound >= 2` (at least one match has teams)
- `allTeams: true` when `teamsFound >= 18` (most/all teams announced)
- `ppCount` = raw count of players found across all rosters

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

### Pre-teams dry run (before Footywire selections are announced)
```
GET /api/lockout-notify?dry=1&force=1&preteams=1&round=0&token=<NOTIFY_SECRET>
```
- `preteams=1` — skips Footywire selection check; still excludes bye players and MONTHS/SEASON injuries
- `round=0` — Opening Round (use the actual round number for later rounds)
- Returns a `preview` field with the full Telegram message text
- Nothing is saved or sent when `dry=1`

## Your weekly team-update duty (add to heartbeat.md)

This is a **recurring task** you must run every round of the AFL season.
Add it as a scheduled item in your `heartbeat.md` so it fires automatically.

### Goal
Ensure the user's DuzzaTip team + tips are computed, saved, and sent via Telegram
**before lockout** each round.

### Timing — when to check
- Use the fixture data to find the **first match of each round** (earliest `DateUtc`).
- AFL teams are typically announced **~24 hours before** the first match of the round
  (e.g. if first game is Thu 7:30pm AEST, teams come out Wed evening).
- Teams are always published first at: https://www.afl.com.au/matches/team-lineups
- Start polling **~1 hour before the first fixture of the round** as a safety net,
  but ideally catch the announcement the day before.
- **Primary check:** the day before the first match, from ~5pm AEST onwards.
- If teams are not yet announced, poll every 15–20 min until either
  `announced == true` or `lockout.locked == true`.

### Polling window
- **Day before first match, 5pm AEST → match-day 1hr before lockout** is the target window.
- Outside this window teams are almost never announced, so no need to poll.

### Decision logic (two-phase team announcements)

The AFL staggers team announcements: a few teams are released **~24h before** the
first game (usually Thursday teams on Wednesday evening), then the remaining teams
are released **~1hr before** the first game of the round.

The API handles this automatically with two-phase notifications:
- **Phase 1 (partial):** Fires when the first teams drop (`announced: true`, `allTeams: false`).
  The Telegram message is tagged "_(X teams — partial, update to follow)_".
  Players from unannounced teams show as "unknown" status.
- **Phase 2 (full):** Fires again when significantly more teams appear (`allTeams: true`).
  The API internally tracks how many teams it notified with, and re-triggers
  when the count jumps. No action needed from you — just keep polling.

```
1. Fetch https://www.afl.com.au/matches/team-lineups
   → Check if team lineups are populated (not just "TBC" / empty squads)
2. If teams look announced:
     GET /api/lockout-notify?probe=1&token=<secret>   ← confirms via the API
3. If probe says announced == true AND lockout.locked == false:
     POST /api/lockout-notify?token=<secret>
     → The API will send a notification and record how many teams were available
4. If allTeams == false: KEEP POLLING every 15-20 min
     → When more teams appear, POST again — the API will send an updated notification
     → Once allTeams == true OR lockout.locked == true, stop polling
5. If allTeams == true: stop polling (all teams in, notification sent)
6. If lockout.locked == true: stop polling (too late — log a warning)
```

### What to log in heartbeat.md
After each round's check, append a status line:
```
## DuzzaTip Weekly Team Update
- Round <N>: <timestamp AEST> — <result>
```
Where `<result>` is one of:
- `✅ Team + tips saved & sent (X teams — partial)` (phase 1, keep polling)
- `✅ Team + tips saved & sent (all teams)` (phase 2, done)
- `⏳ Teams not announced, polling…` (still waiting)
- `⏭ Skipped — already notified with X teams` (API dedup, keep polling for more)
- `⚠️ Lockout passed — missed window` (too late)
- `🔧 Manual trigger by user` (force push)

### One-off manual trigger
If the user asks you to send the brief now:
```
POST https://duzzatip.vercel.app/api/lockout-notify?force=1&token=<NOTIFY_SECRET>
```

## What the user receives

A Telegram message from @woodenduck_bot with:
- Round + lockout countdown
- 9-slot team (FF/TF/OFF/MID/TAK/RUC/Bench/Res A/Res B) + projected pts
- Each player tagged with data source: `[2025(23g)]`, `[2026(5g)]`, or `[blend(5+23g)]`
- Bench line shows expected pts gain: `🪑 Bench — Bontempelli, M → MID (+7.4pts exp)`
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

### Bench selection algorithm (variance-based expected gain)
After the 6 main positions are filled, the bench player AND their backup position
are chosen together by maximising:

```
E[max(bench_score, main_score) − main_score]
```

computed over all game-pair combinations from historical data. This means:
- A volatile MID (boom-bust) is a better backup target than a consistent RUC
- A bench player who outscores the main on bad days is worth more than a raw high scorer
- The `+X.Xpts exp` shown in Telegram is the average expected bonus per round

Reserve A and Reserve B are re-picked from what remains after bench is chosen.

### 2025 → 2026 score blending
Before the 2026 season has enough data, player scores are blended:
```
w = min(games_played_2026, 10) / 10
blended_score = w × score_2026 + (1−w) × score_2025
```
- **Opening Round**: w=0 → pure 2025 role-fit scores
- **After 10 rounds**: w=1 → fully trusts 2026 data
- Source shown per player: `[2025(23g)]`, `[blend(3+23g)]`, `[2026(10g)]`

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
- "Give me a pre-teams lineup preview" →
  `GET /api/lockout-notify?dry=1&force=1&preteams=1&round=<N>&token=<NOTIFY_SECRET>`
  Returns JSON with `preview` field containing the full lineup based on 2025 role-fit scores.
  Nothing is saved or sent to Telegram.
- "Send me the player stats / position report" or "how does my squad rank by position?" →
  `POST https://duzzatip.vercel.app/api/stats-report?send=1&token=<NOTIFY_SECRET>`
  This sends a multi-message Telegram breakdown of your squad's 2025 position scores.
  Add `&league=1` to also see league-wide top players per position.
  Add `&pos=MID` to filter to a single position (FF/TF/OFF/MID/TAK/RUC).
  Add `&format=text` to get plain text response instead of JSON.

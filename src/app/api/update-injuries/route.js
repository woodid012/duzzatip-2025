/**
 * DuzzaTip 2026 — Update Injuries API Route
 * GET /api/update-injuries?token=...
 *
 * Scrapes afl.com.au/matches/injury-list, parses player injuries,
 * and upserts to MongoDB `injuries` collection.
 *
 * Auth: ?token=<NOTIFY_SECRET>
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { connectToDatabase } from "@/app/lib/mongodb";

const YEAR = 2026;
const INJURY_URL = "https://www.afl.com.au/matches/injury-list";

// ── Auth ──────────────────────────────────────────────────────────────────────
function checkAuth(request) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  const { searchParams } = new URL(request.url);
  if (searchParams.get("token") === secret) return true;
  return false;
}

// ── Team name normalisation ───────────────────────────────────────────────────
// The injury page uses full team names like "Adelaide Crows", "Brisbane Lions", etc.
// We normalise to the display-friendly short name used in our DB.
const TEAM_DISPLAY = {
  "adelaide crows": "Adelaide",
  "brisbane lions": "Brisbane",
  "carlton": "Carlton",
  "collingwood": "Collingwood",
  "essendon": "Essendon",
  "fremantle": "Fremantle",
  "geelong cats": "Geelong",
  "gold coast suns": "Gold Coast",
  "gws giants": "GWS",
  "greater western sydney giants": "GWS",
  "hawthorn": "Hawthorn",
  "melbourne": "Melbourne",
  "north melbourne": "North Melbourne",
  "port adelaide": "Port Adelaide",
  "richmond": "Richmond",
  "st kilda": "St Kilda",
  "sydney swans": "Sydney",
  "west coast eagles": "West Coast",
  "western bulldogs": "Western Bulldogs",
};

function normaliseTeam(raw) {
  const key = (raw || "").toLowerCase().replace(/\s+/g, " ").trim();
  return TEAM_DISPLAY[key] || raw.trim();
}

// ── Severity classification ───────────────────────────────────────────────────
const MAJOR_INJURY_KEYWORDS = ["acl", "hip surgery", "achilles", "spinal", "vertebra"];

function classifySeverity(estimatedReturn, injuryType) {
  const ret = (estimatedReturn || "").toLowerCase().trim();
  const inj = (injuryType || "").toLowerCase().trim();

  // "Mid-season" = MONTHS (check before "season" to avoid false SEASON match)
  if (ret.includes("mid-season") || ret.includes("mid season")) return "MONTHS";

  // Season / Indefinite
  if (ret.includes("season") || ret.includes("indefinite")) return "SEASON";

  // TBC with major injury → MONTHS
  if (ret === "tbc" || ret.includes("tbc")) {
    if (MAJOR_INJURY_KEYWORDS.some(kw => inj.includes(kw))) return "MONTHS";
    // Check for 8+ weeks in the return string (unlikely with TBC but handle it)
    return "MONTHS"; // TBC generally = unknown long-term
  }

  // "6-plus weeks"
  if (ret.includes("6-plus") || ret.includes("6+")) return "MONTHS";

  // Parse numeric weeks
  const weeksMatch = ret.match(/(\d+)\s*(?:-\s*(\d+))?\s*week/i);
  if (weeksMatch) {
    const maxWeeks = parseInt(weeksMatch[2] || weeksMatch[1]);
    if (maxWeeks >= 8) return "MONTHS";
    if (maxWeeks >= 4) return "MONTHS";
    return "WEEKS"; // 1-3 weeks
  }

  // Parse months
  const monthsMatch = ret.match(/(\d+)\s*month/i);
  if (monthsMatch) return "MONTHS";

  // Test / game-day decision
  if (ret.includes("test") || ret.includes("game day") || ret.includes("game-day")) return "DOUBT";

  // Suspension
  if (ret.includes("suspension") || ret.includes("suspended")) return "WEEKS";

  // Default
  return "WEEKS";
}

// ── Image filename → team mapping ─────────────────────────────────────────────
// The AFL injury page uses a promo-image section with a team logo image before
// each injury table. The filename in the image URL identifies the team.
const IMAGE_SLUG_TO_TEAM = {
  "adelaide":         "Adelaide",
  "brisbane":         "Brisbane",
  "carlton":          "Carlton",
  "collingwood":      "Collingwood",
  "essendon":         "Essendon",
  "fremantle":        "Fremantle",
  "geelong":          "Geelong",
  "gc":               "Gold Coast",
  "gold-coast":       "Gold Coast",
  "gws":              "GWS",
  "hawthorn":         "Hawthorn",
  "melbourne":        "Melbourne",
  "north-melbourne":  "North Melbourne",
  "port-adelaide":    "Port Adelaide",
  "richmond":         "Richmond",
  "stk":              "St Kilda",
  "st-kilda":         "St Kilda",
  "sydney":           "Sydney",
  "west-coast":       "West Coast",
  "western-bulldogs": "Western Bulldogs",
};

function teamFromImageUrl(url) {
  // Extract filename: e.g. "adelaide-strap-new-logo-2024.jpg" → try prefixes
  const filename = (url || "").split("/").pop()?.split("?")[0]?.toLowerCase() || "";
  for (const [slug, team] of Object.entries(IMAGE_SLUG_TO_TEAM)) {
    if (filename.startsWith(slug)) return team;
  }
  return null;
}

// ── HTML parsing ──────────────────────────────────────────────────────────────
// Structure: each team has a <section class="promo-image"> with a logo image,
// immediately followed by a <table> with PLAYER | INJURY | ESTIMATED RETURN rows.
// After the table there's an editorial "In the mix" section (noise — skip it).

function parseInjuryHtml(html) {
  const players = {};

  // Find all team logo images (promo-image sections) and their positions
  const imageRe = /promo-image__image[^>]+src="([^"]+)"/gi;
  const imagePositions = [];
  let m;
  while ((m = imageRe.exec(html)) !== null) {
    const team = teamFromImageUrl(m[1]);
    if (team && !imagePositions.some(p => p.team === team)) {
      imagePositions.push({ team, pos: m.index });
    }
  }

  // Find all tables and associate each with the nearest preceding team image
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  while ((m = tableRe.exec(html)) !== null) {
    const tableHtml = m[1];

    // Only process tables that have a PLAYER header (injury tables)
    if (!/<th[^>]*>[\s\S]*?PLAYER[\s\S]*?<\/th>/i.test(tableHtml)) continue;

    // Find which team this table belongs to (nearest preceding image)
    let team = null;
    for (const img of imagePositions) {
      if (img.pos < m.index) team = img.team;
    }
    if (!team) continue;

    // Extract rows with 3 <td> cells: Player, Injury, Return
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
      }

      if (cells.length < 3) continue;
      const name = cells[0];
      const injury = cells[1];
      const returnEst = cells[cells.length - 1];

      // Skip header rows, "Updated:" rows, and empty names
      if (!name || /^(player|name|updated)$/i.test(name) || /^updated:/i.test(name)) continue;

      const severity = classifySeverity(returnEst, injury);
      const detail = `${injury}, ${returnEst}`.replace(/\s+/g, " ").trim();

      // Handle duplicate names (e.g. "Max King" at two clubs)
      // If the name already exists for a different team, use "Name (Team)" keys for both
      if (players[name] && players[name].team !== team) {
        // Move existing entry to "Name (Team)" format
        const existing = players[name];
        players[`${name} (${existing.team})`] = existing;
        delete players[name];
        // Store new entry with team suffix
        players[`${name} (${team})`] = { status: severity, detail, team };
      } else if (players[`${name} (${team})`]) {
        // Already disambiguated, update in place
        players[`${name} (${team})`] = { status: severity, detail, team };
      } else {
        players[name] = { status: severity, detail, team };
      }
    }
  }

  return players;
}

// ── Route handler ────────────────────────────────────────────────────────────
export async function GET(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch the injury list page
    const res = await fetch(INJURY_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DuzzaTip/1.0)",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return Response.json({ error: `AFL page returned ${res.status}` }, { status: 502 });
    }

    const html = await res.text();
    const players = parseInjuryHtml(html);
    const count = Object.keys(players).length;

    if (count === 0) {
      return Response.json({
        ok: false,
        error: "No injuries parsed — page structure may have changed",
        htmlLength: html.length,
      }, { status: 422 });
    }

    // Upsert to MongoDB
    const { db } = await connectToDatabase();
    const now = new Date();

    await db.collection("injuries").updateOne(
      { _id: `injuries_${YEAR}` },
      {
        $set: {
          year: YEAR,
          updated: now,
          players,
        },
      },
      { upsert: true }
    );

    return Response.json({
      ok: true,
      count,
      updated: now.toISOString(),
      sample: Object.entries(players).slice(0, 5).map(([name, info]) => ({ name, ...info })),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

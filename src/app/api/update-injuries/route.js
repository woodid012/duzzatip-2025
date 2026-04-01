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

// ── Team identification from image URLs ──────────────────────────────────────
// The AFL injury page has a promo-image before each team's injury table.
// We match team from the image URL using multiple strategies so that changes
// to the AFL's image naming don't break us.
const TEAM_SLUGS = {
  // Full names (old-style filenames like "adelaide-strap-new-logo.jpg")
  "adelaide":         "Adelaide",
  "brisbane":         "Brisbane",
  "carlton":          "Carlton",
  "collingwood":      "Collingwood",
  "essendon":         "Essendon",
  "fremantle":        "Fremantle",
  "geelong":          "Geelong",
  "gold-coast":       "Gold Coast",
  "hawthorn":         "Hawthorn",
  "melbourne":        "Melbourne",
  "north-melbourne":  "North Melbourne",
  "port-adelaide":    "Port Adelaide",
  "richmond":         "Richmond",
  "st-kilda":         "St Kilda",
  "sydney":           "Sydney",
  "west-coast":       "West Coast",
  "western-bulldogs": "Western Bulldogs",
  // Short abbreviations (new-style: "..._ADEL_FA-1x.jpg")
  "adel":  "Adelaide",
  "bris":  "Brisbane",
  "carl":  "Carlton",
  "coll":  "Collingwood",
  "ess":   "Essendon",
  "frem":  "Fremantle",
  "geel":  "Geelong",
  "gcs":   "Gold Coast",
  "gc":    "Gold Coast",
  "gws":   "GWS",
  "haw":   "Hawthorn",
  "melb":  "Melbourne",
  "nm":    "North Melbourne",
  "pa":    "Port Adelaide",
  "rich":  "Richmond",
  "stk":   "St Kilda",
  "syd":   "Sydney",
  "wce":   "West Coast",
  "wb":    "Western Bulldogs",
};

function teamFromImageUrl(url) {
  const lower = (url || "").toLowerCase();
  // Try to find any slug anywhere in the URL (not just filename prefix)
  // Sort by length descending so "north-melbourne" matches before "melbourne"
  const sorted = Object.entries(TEAM_SLUGS).sort((a, b) => b[0].length - a[0].length);
  for (const [slug, team] of sorted) {
    // Match slug as a word boundary — preceded/followed by non-alpha
    const re = new RegExp(`(?:^|[^a-z])${slug.replace(/-/g, "[-_]?")}(?=$|[^a-z])`, "i");
    if (re.test(lower)) return team;
  }
  return null;
}

// ── Alphabetical team order (fallback) ───────────────────────────────────────
// AFL always lists teams alphabetically. If image-based detection fails,
// we assign teams to injury tables by their position.
const TEAMS_ALPHABETICAL = [
  "Adelaide", "Brisbane", "Carlton", "Collingwood", "Essendon",
  "Fremantle", "Geelong", "Gold Coast", "GWS", "Hawthorn",
  "Melbourne", "North Melbourne", "Port Adelaide", "Richmond",
  "St Kilda", "Sydney", "West Coast", "Western Bulldogs",
];

// ── HTML parsing ──────────────────────────────────────────────────────────────

function parseInjuryHtml(html) {
  const players = {};

  // Strategy 1: Find team logo images and their positions
  const imageRe = /promo-image__image[^>]+src="([^"]+)"/gi;
  const imagePositions = [];
  let m;
  while ((m = imageRe.exec(html)) !== null) {
    const team = teamFromImageUrl(m[1]);
    if (team && !imagePositions.some(p => p.team === team)) {
      imagePositions.push({ team, pos: m.index });
    }
  }

  // Collect all injury tables (tables with a PLAYER header)
  const injuryTables = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  while ((m = tableRe.exec(html)) !== null) {
    if (/<th[^>]*>[\s\S]*?PLAYER[\s\S]*?<\/th>/i.test(m[1])) {
      injuryTables.push({ html: m[1], pos: m.index });
    }
  }

  // Decide team assignment strategy
  const useImages = imagePositions.length >= injuryTables.length;

  for (let i = 0; i < injuryTables.length; i++) {
    const tableHtml = injuryTables[i].html;
    const tablePos = injuryTables[i].pos;

    // Determine team
    let team = null;
    if (useImages) {
      // Nearest preceding image
      for (const img of imagePositions) {
        if (img.pos < tablePos) team = img.team;
      }
    }
    // Fallback: alphabetical ordering
    if (!team && i < TEAMS_ALPHABETICAL.length) {
      team = TEAMS_ALPHABETICAL[i];
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
      players[`${name} (${team})`] = { status: severity, detail, team };
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

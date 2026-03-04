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

  // Season / Indefinite
  if (ret.includes("season") || ret.includes("indefinite")) return "SEASON";

  // TBC with major injury → MONTHS
  if (ret === "tbc" || ret.includes("tbc")) {
    if (MAJOR_INJURY_KEYWORDS.some(kw => inj.includes(kw))) return "MONTHS";
    // Check for 8+ weeks in the return string (unlikely with TBC but handle it)
    return "MONTHS"; // TBC generally = unknown long-term
  }

  // "6-plus weeks", "Mid-season"
  if (ret.includes("mid-season") || ret.includes("mid season")) return "MONTHS";
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

// ── HTML parsing ──────────────────────────────────────────────────────────────
// The AFL injury list page renders a table per team. We parse the HTML to extract
// player name, injury type, and estimated return for each row.

function parseInjuryHtml(html) {
  const players = {};

  // The page has sections per team. Each team section has a heading and table rows.
  // We look for team headings and then player rows within each team section.

  // Strategy: find all team sections. The AFL page uses a structure like:
  //   <h3 class="...">Team Name</h3> (or similar heading)
  //   followed by table rows with player data

  // Match team heading patterns — AFL uses various heading elements
  // Try to find team blocks: look for team name patterns followed by player entries

  // First, let's try to extract structured data from the page
  // The AFL injury list typically has a consistent structure per team

  let currentTeam = null;

  // Split by common team section markers
  // AFL.com.au uses elements like: <h3>Team Name</h3> or data attributes
  // We'll use a regex approach to find team headings and player rows

  // Find all team headings (h2, h3, h4 with team names, or specific class patterns)
  const teamPattern = /class="[^"]*(?:injury-list-club|team-name|club-name)[^"]*"[^>]*>([^<]+)</gi;
  const headingPattern = /<h[23456][^>]*>([^<]*(?:Crows|Lions|Carlton|Collingwood|Essendon|Fremantle|Cats|Suns|Giants|Hawthorn|Melbourne|North Melbourne|Port Adelaide|Richmond|St Kilda|Swans|Eagles|Bulldogs)[^<]*)<\/h[23456]>/gi;

  // Try structured approach: split HTML by team sections
  // Look for any element containing a known team name that acts as a section header
  const teamNames = Object.keys(TEAM_DISPLAY).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const teamSectionRe = new RegExp(`(?:<[^>]+>\\s*)(${teamNames.join("|")})(?:\\s*<[^>]+>)`, "gi");

  // Simpler approach: find all table rows with player data
  // AFL page typically has rows like: <td>Player Name</td><td>Injury</td><td>Return</td>

  // Extract all rows that look like player injury entries
  // Pattern: three consecutive td cells in a row
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  // First pass: find team sections by looking for team names in headings or strong tags
  const sections = [];
  const sectionPattern = /(<(?:h[1-6]|div|span|strong)[^>]*>[^<]*(?:Adelaide|Brisbane|Carlton|Collingwood|Essendon|Fremantle|Geelong|Gold Coast|GWS|Greater Western Sydney|Hawthorn|Melbourne|North Melbourne|Port Adelaide|Richmond|St Kilda|Sydney|West Coast|Western Bulldogs)[^<]*<\/(?:h[1-6]|div|span|strong)>)/gi;

  let sectionMatch;
  const sectionPositions = [];
  while ((sectionMatch = sectionPattern.exec(html)) !== null) {
    // Extract team name from the match
    const teamText = sectionMatch[1].replace(/<[^>]+>/g, "").trim();
    sectionPositions.push({ team: normaliseTeam(teamText), pos: sectionMatch.index });
  }

  // For each section, extract player rows until next section
  for (let i = 0; i < sectionPositions.length; i++) {
    const start = sectionPositions[i].pos;
    const end = i + 1 < sectionPositions.length ? sectionPositions[i + 1].pos : html.length;
    const sectionHtml = html.substring(start, end);
    const team = sectionPositions[i].team;

    // Find all table rows in this section
    let rowMatch;
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((rowMatch = rowRe.exec(sectionHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = [];
      let cellMatch;
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
      }

      // Expect at least: Player Name, Injury, Estimated Return
      if (cells.length >= 3) {
        const name = cells[0];
        const injury = cells[1];
        const returnEst = cells[cells.length - 1]; // last cell is usually return timeline

        // Skip header rows
        if (!name || name.toLowerCase() === "player" || name.toLowerCase() === "name") continue;

        const severity = classifySeverity(returnEst, injury);
        const detail = `${injury}, ${returnEst}`.replace(/\s+/g, " ").trim();

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

// Shared helpers used by both the lockout-notify CLI script and the
// /api/lockout-notify route. CommonJS exports so the Node CLI can `require`
// this and Next.js can `import` it via CJS interop.
//
// The previous duplication caused real outages: when AFL switched to
// Indigenous-language team names, we had to fix the same TEAM_ALIASES
// and team-name preference in two places. Putting it here means one fix.

const AFL_COMP_SEASON_ID = 85; // 2026 Toyota AFL Premiership

// ── Team aliases (lockout slug ↔ display name) ──────────────────────────────
// Indigenous-language names included so the AFL roster API matches even when
// the API returns the themed team.name; team.club.name is preferred where
// available and this is the backstop.
const TEAM_ALIASES = {
  "adelaide-crows":    ["ADE", "Adelaide", "Adelaide Crows", "Kuwarna"],
  "brisbane-lions":    ["BRL", "BL", "Brisbane", "Brisbane Lions"],
  "carlton":           ["CAR", "Carlton", "Carlton Blues"],
  "collingwood":       ["COL", "Collingwood", "Collingwood Magpies"],
  "essendon":          ["ESS", "Essendon", "Essendon Bombers"],
  "fremantle":         ["FRE", "Fremantle", "Fremantle Dockers", "Walyalup"],
  "geelong-cats":      ["GEE", "Geelong", "Geelong Cats"],
  "gold-coast-suns":   ["GCS", "GC", "Gold Coast", "Gold Coast SUNS", "Gold Coast Suns"],
  "gws-giants":        ["GWS", "GWS Giants", "GWS GIANTS", "Greater Western Sydney"],
  "hawthorn":          ["HAW", "Hawthorn", "Hawthorn Hawks"],
  "melbourne":         ["MEL", "Melbourne", "Melbourne Demons", "Narrm"],
  "north-melbourne":   ["NTH", "North", "North Melbourne", "North Melbourne Kangaroos"],
  "port-adelaide":     ["PTA", "Port", "Port Adelaide", "Port Adelaide Power", "Yartapuulti"],
  "richmond":          ["RIC", "Richmond", "Richmond Tigers"],
  "st-kilda":          ["STK", "St Kilda", "St Kilda Saints", "Euro-Yroke"],
  "sydney-swans":      ["SYD", "Sydney", "Sydney Swans"],
  "west-coast-eagles": ["WCE", "West Coast", "West Coast Eagles", "Waalitj Marawar"],
  "western-bulldogs":  ["WBD", "WB", "Western Bulldogs"],
};

// Squiggle uses short forms — map to fixture display names.
const SQUIGGLE_TEAMS = {
  "Adelaide":                "Adelaide Crows",
  "Brisbane Lions":          "Brisbane Lions",
  "Carlton":                 "Carlton",
  "Collingwood":             "Collingwood",
  "Essendon":                "Essendon",
  "Fremantle":               "Fremantle",
  "Geelong":                 "Geelong Cats",
  "Gold Coast":              "Gold Coast SUNS",
  "Greater Western Sydney":  "GWS GIANTS",
  "Hawthorn":                "Hawthorn",
  "Melbourne":               "Melbourne",
  "North Melbourne":         "North Melbourne",
  "Port Adelaide":           "Port Adelaide",
  "Richmond":                "Richmond",
  "St Kilda":                "St Kilda",
  "Sydney":                  "Sydney Swans",
  "West Coast":              "West Coast Eagles",
  "Western Bulldogs":        "Western Bulldogs",
};

// Sportsbet names are scraped from HTML and inconsistent — fuzzy lookup map
// keyed by lowercase nickname/short form, pointing at fixture name.
const SPORTSBET_ALIASES = {
  "adelaide": "Adelaide Crows", "crows": "Adelaide Crows",
  "brisbane": "Brisbane Lions", "brisbane lions": "Brisbane Lions", "lions": "Brisbane Lions",
  "carlton": "Carlton", "blues": "Carlton",
  "collingwood": "Collingwood", "magpies": "Collingwood",
  "essendon": "Essendon", "bombers": "Essendon",
  "fremantle": "Fremantle", "dockers": "Fremantle",
  "geelong": "Geelong Cats", "geelong cats": "Geelong Cats", "cats": "Geelong Cats",
  "gold coast": "Gold Coast SUNS", "gold coast suns": "Gold Coast SUNS", "suns": "Gold Coast SUNS",
  "gws": "GWS GIANTS", "gws giants": "GWS GIANTS", "greater western sydney": "GWS GIANTS", "giants": "GWS GIANTS",
  "hawthorn": "Hawthorn", "hawks": "Hawthorn",
  "melbourne": "Melbourne", "demons": "Melbourne",
  "north melbourne": "North Melbourne", "kangaroos": "North Melbourne",
  "port adelaide": "Port Adelaide", "power": "Port Adelaide",
  "richmond": "Richmond", "tigers": "Richmond",
  "st kilda": "St Kilda", "saints": "St Kilda",
  "sydney": "Sydney Swans", "sydney swans": "Sydney Swans", "swans": "Sydney Swans",
  "west coast": "West Coast Eagles", "west coast eagles": "West Coast Eagles", "eagles": "West Coast Eagles",
  "western bulldogs": "Western Bulldogs", "bulldogs": "Western Bulldogs",
};

// ── Name helpers ────────────────────────────────────────────────────────────
function normName(n) {
  return (n || "").toLowerCase().replace(/'/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

function findTeamSlug(dbTeam) {
  const dbT = (dbTeam || "").toLowerCase().trim();
  for (const [slug, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === dbT)) return slug;
  }
  for (const [slug, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(a => dbT.includes(a.toLowerCase()) || a.toLowerCase().includes(dbT))) return slug;
    if (slug.replace(/-/g, " ").includes(dbT) || dbT.includes(slug.replace(/-/g, " "))) return slug;
  }
  return null;
}

function aflTeamNameToSlug(aflName) {
  const n = (aflName || "").toLowerCase().trim();
  for (const [slug, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === n)) return slug;
  }
  for (const [slug] of Object.entries(TEAM_ALIASES)) {
    if (slug.replace(/-/g, " ") === n) return slug;
  }
  return null;
}

// ── AFL API ─────────────────────────────────────────────────────────────────
async function getAFLToken() {
  const res = await fetch("https://api.afl.com.au/cfs/afl/WMCTok", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "https://www.afl.com.au" },
    body: "{}",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`AFL token HTTP ${res.status}`);
  const data = await res.json();
  return data.token;
}

// Fetch named-22 + emergencies per team for a given round, via the official
// AFL match-roster endpoints. Prefers /full (richer payload), falls back to
// the base endpoint (used by Opening Round). Returns { selections, teamsFound,
// ppCount, error? } where selections is keyed by team slug.
async function fetchAFLTeamSelections(roundNumber) {
  try {
    const token = await getAFLToken();
    const headers = { "x-media-mis-token": token };

    const matchesRes = await fetch(
      `https://aflapi.afl.com.au/afl/v2/matches?competitionId=1&compSeasonId=${AFL_COMP_SEASON_ID}&roundNumber=${roundNumber}&pageSize=20`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    const matchesData = await matchesRes.json();
    const matches = matchesData.matches || [];

    const result = {};
    let ppCount = 0;
    let teamsFound = 0;

    await Promise.all(matches.map(async (match) => {
      const providerId = match.providerId;
      if (!providerId) return;
      try {
        let roster = null;
        let usedFull = false;

        const fullRes = await fetch(
          `https://api.afl.com.au/cfs/afl/matchRoster/full/${providerId}`,
          { headers, signal: AbortSignal.timeout(10000) }
        );
        if (fullRes.ok) {
          const fullData = await fullRes.json();
          const hasPositions = (fullData.homeTeam?.positions?.length || 0) + (fullData.awayTeam?.positions?.length || 0) > 0;
          if (hasPositions) { roster = fullData; usedFull = true; }
        }

        if (!roster) {
          const baseRes = await fetch(
            `https://api.afl.com.au/cfs/afl/matchRoster/${providerId}`,
            { headers, signal: AbortSignal.timeout(10000) }
          );
          if (baseRes.ok) roster = await baseRes.json();
        }

        if (!roster) return;

        for (const side of ["homeTeam", "awayTeam"]) {
          const teamData = roster[side];
          if (!teamData) continue;
          const matchSide = match[side.replace("Team", "")];
          // Prefer team.club.name (stable English) over team.name (rotates
          // through Indigenous variants like Walyalup/Narrm/etc.)
          const teamName = matchSide?.team?.club?.name
            || teamData.teamName?.teamName
            || matchSide?.team?.name
            || "";
          const slug = aflTeamNameToSlug(teamName);
          if (!slug) continue;

          const named22 = [];
          const emergencies = [];
          for (const player of (teamData.positions || [])) {
            const givenName = usedFull
              ? (player.givenName || "")
              : (player.player?.playerName?.givenName || "");
            const surname = usedFull
              ? (player.surname || "")
              : (player.player?.playerName?.surname || "");
            const name = `${givenName} ${surname}`.trim();
            if (!name) continue;
            if (player.position === "EMERG") emergencies.push(name);
            else named22.push(name);
          }
          if (named22.length > 0 || emergencies.length > 0) {
            result[slug] = { named22, emergencies };
            ppCount += named22.length + emergencies.length;
            teamsFound++;
          }
        }
      } catch (_) {}
    }));

    return { selections: teamsFound > 0 ? result : null, teamsFound, ppCount };
  } catch (e) {
    return { selections: null, teamsFound: 0, ppCount: 0, error: e.message };
  }
}

// ── Squiggle ────────────────────────────────────────────────────────────────
// Squiggle is reachable from Vercel but the AU→US-East round trip is slow
// and occasionally drops. Keep it to a single bounded attempt so a slow
// Squiggle can't take the whole route past Vercel's function timeout; the
// caller surfaces the diagnostic when we can't get tips.
async function fetchSquiggleTips(round, year) {
  const url = `https://api.squiggle.com.au/?q=tips;year=${year};round=${round}`;
  const headers = { "User-Agent": "DuzzaTip/1.0 (+https://duzzatip.vercel.app; expense.woodenduck@gmail.com)" };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { tips: null, fetchError: `Squiggle fetch failed (round ${round}): HTTP ${res.status}` };
    const data = await res.json();
    if (data?.tips?.length) return { tips: data.tips, fetchError: null };
    return { tips: null, fetchError: `Squiggle fetch failed (round ${round}): empty tips array` };
  } catch (e) {
    const reason = e?.name === "TimeoutError" ? "timeout after 10s" : (e?.message || "fetch failed");
    return { tips: null, fetchError: `Squiggle fetch failed (round ${round}): ${reason}` };
  }
}

// ── Sportsbet ───────────────────────────────────────────────────────────────
async function fetchSportsbetOdds() {
  try {
    const { load } = await import("cheerio");
    const res = await fetch("https://www.sportsbet.com.au/betting/australian-rules", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = load(html);
    const odds = {};

    $("[data-automation-id]").each((_, el) => {
      const id = $(el).attr("data-automation-id") || "";
      if (id.includes("price") || id.includes("participant")) {
        const text = $(el).text().trim();
        const price = parseFloat(text);
        if (!isNaN(price) && price > 1) {
          const name = $(el).closest("[data-automation-id*='event']").find("[data-automation-id*='name']").first().text().trim();
          if (name) odds[name] = price;
        }
      }
    });

    if (Object.keys(odds).length === 0) {
      $("script").each((_, el) => {
        const txt = $(el).html() || "";
        const match = txt.match(/"name"\s*:\s*"([^"]+)"[^}]+"win"\s*:\s*(\d+\.?\d*)/g);
        if (match) {
          match.forEach(m => {
            const nm = m.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
            const price = parseFloat(m.match(/"win"\s*:\s*(\d+\.?\d*)/)?.[1]);
            if (nm && !isNaN(price) && price > 1) odds[nm] = price;
          });
        }
      });
    }

    return Object.keys(odds).length > 0 ? odds : null;
  } catch (_) { return null; }
}

// ── Tip suggestion builder ──────────────────────────────────────────────────
// Squiggle drives confidence first; Sportsbet odds (if available) override
// with implied probability. squiggleUnmatched is set when Squiggle returned
// tips for the round but none matched the fixture by team name — that's
// always a dictionary bug, never a real 50/50 signal, so the caller can
// surface it as an error.
function buildTipSuggestions(roundFixtures, squiggleTips, sportsbetOdds) {
  const tips = roundFixtures.map(f => {
    let homePct = 50, source = "default";
    let homeOdds = null, awayOdds = null;
    let squiggleUnmatched = false;

    if (squiggleTips) {
      const candidates = squiggleTips.filter(t =>
        SQUIGGLE_TEAMS[t.hteam] === f.HomeTeam &&
        SQUIGGLE_TEAMS[t.ateam] === f.AwayTeam
      );
      if (candidates.length > 0) {
        homePct = candidates.reduce((a, t) => {
          const explicitHomePct = parseFloat(t.hconfidence);
          if (!Number.isNaN(explicitHomePct)) return a + explicitHomePct;
          const tippedPct = parseFloat(t.confidence);
          if (Number.isNaN(tippedPct)) return a + 50;
          // Compare t.tip to t.hteam (both in Squiggle's naming) — t.tip uses
          // short names that won't strict-equal the fixture's long name.
          return a + (t.tip === t.hteam ? tippedPct : 100 - tippedPct);
        }, 0) / candidates.length;
        source = `Squiggle(${candidates.length})`;
      } else {
        squiggleUnmatched = true;
      }
    }

    if (sportsbetOdds) {
      const homeKey = Object.keys(sportsbetOdds).find(k => SPORTSBET_ALIASES[k.toLowerCase().trim()] === f.HomeTeam);
      const awayKey = Object.keys(sportsbetOdds).find(k => SPORTSBET_ALIASES[k.toLowerCase().trim()] === f.AwayTeam);
      if (homeKey && awayKey) {
        homeOdds = sportsbetOdds[homeKey];
        awayOdds = sportsbetOdds[awayKey];
        const hProb = 1 / homeOdds;
        const aProb = 1 / awayOdds;
        homePct = Math.round((hProb / (hProb + aProb)) * 100);
        source = `Sportsbet`;
      }
    }

    const favourite = homePct >= 50 ? f.HomeTeam : f.AwayTeam;
    const confidence = Math.round(Math.max(homePct, 100 - homePct));
    const favOdds = favourite === f.HomeTeam ? homeOdds : awayOdds;

    return {
      matchNumber: f.MatchNumber, homeTeam: f.HomeTeam, awayTeam: f.AwayTeam,
      dateUtc: f.DateUtc, favourite, confidence, homeOdds, awayOdds, favOdds, source,
      squiggleUnmatched,
    };
  });

  tips.forEach(t => { if (t.confidence >= 75) t.suggestDC = true; });
  return tips;
}

module.exports = {
  AFL_COMP_SEASON_ID,
  TEAM_ALIASES,
  SQUIGGLE_TEAMS,
  SPORTSBET_ALIASES,
  normName,
  findTeamSlug,
  aflTeamNameToSlug,
  getAFLToken,
  fetchAFLTeamSelections,
  fetchSquiggleTips,
  fetchSportsbetOdds,
  buildTipSuggestions,
};

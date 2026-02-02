// Draft constants for the annual player draft
// DRAFT_ORDER is the hardcoded fallback — prefer loading from DB via loadDraftOrderFromDB

export const DRAFT_ORDER = [6, 4, 7, 8, 1, 3, 2, 5]; // 2026 draft order based on 2025 results (spoon first, champion last)

export const ROUNDS_PER_DRAFT = 18;
export const USERS_PER_DRAFT = 8;
export const TOTAL_PICKS = ROUNDS_PER_DRAFT * USERS_PER_DRAFT; // 144

// Generate full snake pick order using the hardcoded DRAFT_ORDER
// Odd rounds: 1→8, Even rounds: 8→1
export function getDraftPickOrder() {
  return getDraftPickOrderForArray(DRAFT_ORDER);
}

// Generate full snake pick order for a given draft order array
export function getDraftPickOrderForArray(draftOrder) {
  const picks = [];
  for (let round = 1; round <= ROUNDS_PER_DRAFT; round++) {
    const order = round % 2 === 1 ? [...draftOrder] : [...draftOrder].reverse();
    order.forEach((userId) => {
      picks.push({ pickNumber: picks.length + 1, round, userId });
    });
  }
  return picks;
}

// Load draft order from DB (previous year's final standings)
// Returns array of userIds in draft order (spoon first), or null if not found
export async function loadDraftOrderFromDB(db, year) {
  try {
    const collectionName = `${year}_final_standings`;
    const doc = await db.collection(collectionName).findOne({ year });

    if (doc && doc.standings && doc.standings.length === 8) {
      // standings are already in draft pick order (spoon first, champion last)
      return doc.standings.map(s => s.userId);
    }
    return null;
  } catch (error) {
    console.error(`Error loading draft order from DB for year ${year}:`, error);
    return null;
  }
}

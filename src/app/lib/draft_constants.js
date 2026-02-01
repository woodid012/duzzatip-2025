// Draft constants for the annual player draft
// Update DRAFT_ORDER with final standings before draft day (spoon picks first)

export const DRAFT_ORDER = [1, 2, 3, 4, 5, 6, 7, 8]; // user IDs, spoon first

export const ROUNDS_PER_DRAFT = 18;
export const USERS_PER_DRAFT = 8;
export const TOTAL_PICKS = ROUNDS_PER_DRAFT * USERS_PER_DRAFT; // 144

// Generate full snake pick order
// Odd rounds: 1→8, Even rounds: 8→1
export function getDraftPickOrder() {
  const picks = [];
  for (let round = 1; round <= ROUNDS_PER_DRAFT; round++) {
    const order = round % 2 === 1 ? [...DRAFT_ORDER] : [...DRAFT_ORDER].reverse();
    order.forEach((userId) => {
      picks.push({ pickNumber: picks.length + 1, round, userId });
    });
  }
  return picks;
}

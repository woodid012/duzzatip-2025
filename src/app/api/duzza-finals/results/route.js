import { createApiHandler, parseYearParam, createSuccessResponse } from '@/app/lib/apiUtils';
import { connectToFinalsDatabase } from '@/app/lib/mongodb';
import { computeBracket } from '@/app/lib/duzzaFinals';

// Read-only — no privacy filtering. Re-derives everything live from the
// entries in duzza_finals + season data (fixtures/players/game_results), so
// there's no snapshot to go stale.
export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const year = parseYearParam(searchParams);

  const finalsDb = await connectToFinalsDatabase();
  const bracket = await computeBracket(db, finalsDb, year);

  return createSuccessResponse({ year, ...bracket });
});

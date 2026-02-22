import { createApiHandler, getCollectionForYear, parseYearParam, blockWritesForPastYear } from '../../lib/apiUtils';

// GET — Retrieve saved final standings for a year
export const GET = createApiHandler(async (request, db) => {
  const { searchParams } = new URL(request.url);
  const year = parseYearParam(searchParams);

  const collection = getCollectionForYear(db, 'final_standings', year);
  const doc = await collection.findOne({ year });

  if (doc) {
    return Response.json({
      year,
      standings: doc.standings,
      savedAt: doc.savedAt,
    });
  }

  return Response.json({
    year,
    standings: null,
    message: 'No final standings saved for this year',
  });
});

// POST — Save final standings for a year
export const POST = createApiHandler(async (request, db) => {
  const body = await request.json();
  const { standings, year: bodyYear } = body;

  const year = (bodyYear && bodyYear >= 2020 && bodyYear <= 2100) ? bodyYear : new Date().getFullYear();

  const blocked = blockWritesForPastYear(year);
  if (blocked) return blocked;

  if (!standings || !Array.isArray(standings) || standings.length === 0) {
    return Response.json({ error: 'standings array is required' }, { status: 400 });
  }

  const collection = getCollectionForYear(db, 'final_standings', year);

  await collection.updateOne(
    { year },
    {
      $set: {
        year,
        standings,
        savedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return Response.json({
    success: true,
    year,
    message: `Final standings saved for ${year}`,
  });
});

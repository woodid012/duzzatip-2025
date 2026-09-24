import { connectToDatabase } from './mongodb';
import { CURRENT_YEAR } from './constants';

export const createApiHandler = (handler) => async (request) => {
  try {
    const { db } = await connectToDatabase();
    return await handler(request, db);
  } catch (error) {
    console.error('Database Error:', error);
    return Response.json({ error: 'Database operation failed' }, { status: 500 });
  }
};

export const getCollection = (db, collectionName) =>
  db.collection(`${CURRENT_YEAR}_${collectionName}`);

export const getCollectionForYear = (db, collectionName, year) => {
  const safeYear = parseInt(year) || CURRENT_YEAR;
  return db.collection(`${safeYear}_${collectionName}`);
};

export const parseYearParam = (searchParams) => {
  const year = parseInt(searchParams.get('year'));
  return year && year >= 2020 && year <= 2100 ? year : CURRENT_YEAR;
};

export const blockWritesForPastYear = (year) => {
  if (parseInt(year) !== CURRENT_YEAR) {
    return Response.json(
      { error: 'Cannot modify data for a past season' },
      { status: 403 }
    );
  }
  return null;
};

export const createSuccessResponse = (data) => {
  return Response.json(data, { status: 200 });
};

// Lets a browser reuse a read it just made — a navigation back to a page it
// was on a moment ago paints from cache instead of waiting on the network.
// Always `private`: several of these responses are filtered per viewer and
// must never sit in a shared CDN.
//
// Deliberately no stale-while-revalidate. A POST to one URL doesn't invalidate
// a cached GET of another, so with it a just-saved dead cert could be shown
// missing from the results for the whole stale window — the cache served the
// pre-save answer and revalidated only in the background. max-age alone bounds
// that to `maxAgeSeconds`, after which the next read waits for a fresh answer.
export const withReadCache = (response, maxAgeSeconds) => {
  response.headers.set('Cache-Control', `private, max-age=${maxAgeSeconds}`);
  return response;
};


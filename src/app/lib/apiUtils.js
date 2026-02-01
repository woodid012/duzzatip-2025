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

export const handleApiError = (error, customMessage = 'Operation failed') => {
  console.error('API Error:', error);
  return Response.json({ error: customMessage }, { status: 500 });
};

export const createSuccessResponse = (data) => {
  return Response.json(data, { status: 200 });
};

export const validateRequest = (request, requiredFields = []) => {
  if (request.method === 'POST' || request.method === 'PUT') {
    const body = request.body;
    const missingFields = requiredFields.filter(field => !body[field]);
    
    if (missingFields.length > 0) {
      return {
        isValid: false,
        error: Response.json(
          { error: `Missing required fields: ${missingFields.join(', ')}` },
          { status: 400 }
        )
      };
    }
  }
  
  return { isValid: true };
};
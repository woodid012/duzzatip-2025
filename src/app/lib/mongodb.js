import { MongoClient, ServerApiVersion } from 'mongodb';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

// Cached connection
let cachedClient = null;
let cachedDb = null;

if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
}

export async function connectToDatabase() {
    // If we have a cached connection, use it
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    // If no cached connection, create a new one
    const client = new MongoClient(MONGODB_URI, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });

    await client.connect();
    const db = client.db('afl_database');

    // Cache the connection
    cachedClient = client;
    cachedDb = db;

    return { client: cachedClient, db: cachedDb };
}
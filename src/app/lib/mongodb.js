import { MongoClient, ServerApiVersion } from 'mongodb';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

let cachedClient = null;
let cachedDb = null;
let connectionTimeout = null;

const TIMEOUT_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

export async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        // Reset timeout
        clearTimeout(connectionTimeout);
        setConnectionTimeout();
        return { client: cachedClient, db: cachedDb };
    }

    const client = new MongoClient(MONGODB_URI, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
        maxPoolSize: 10, // Limit concurrent connections
    });

    await client.connect();
    const db = client.db('afl_database');

    cachedClient = client;
    cachedDb = db;

    setConnectionTimeout();
    return { client, db };
}

function setConnectionTimeout() {
    connectionTimeout = setTimeout(async () => {
        if (cachedClient) {
            await cachedClient.close();
            cachedClient = null;
            cachedDb = null;
        }
    }, TIMEOUT_DURATION);
}
import { MongoClient, ServerApiVersion } from 'mongodb';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

const client = new MongoClient(MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    maxPoolSize: 10,       // Up to 10 connections per instance
    maxIdleTimeMS: 300000, // Close idle connections after 5 minutes
});

let isConnected = false;

export async function connectToDatabase() {
    if (!isConnected) {
        await client.connect();
        isConnected = true;
    }
    return { client, db: client.db('afl_database') };
}
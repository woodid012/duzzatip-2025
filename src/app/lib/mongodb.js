// src/app/lib/mongodb.js
import { MongoClient, ServerApiVersion } from 'mongodb';

const MONGODB_URI = "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";

// Global variable to store the client across hot reloads in development
// and across Lambda function executions in production
let cachedClient = null;
let cachedDb = null;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable');
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let globalWithMongo = global;
if (!globalWithMongo._mongoClientPromise) {
  globalWithMongo._mongoClientPromise = null;
}

export async function connectToDatabase() {
  // If we have a cached connection, use it
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  // If we have a connection promise in progress, wait for it
  if (globalWithMongo._mongoClientPromise) {
    const client = await globalWithMongo._mongoClientPromise;
    const db = client.db('afl_database');
    cachedClient = client;
    cachedDb = db;
    return { client, db };
  }

  // Create a new client if we don't have one
  const client = new MongoClient(MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    maxPoolSize: 10,       // Up to 10 connections per instance
    maxIdleTimeMS: 300000, // Close idle connections after 5 minutes
    connectTimeoutMS: 10000, // Connection timeout
    socketTimeoutMS: 45000, // Socket timeout
  });

  // Store the client promise in the global object
  globalWithMongo._mongoClientPromise = client.connect();
  
  // Wait for the client to connect
  const connectedClient = await globalWithMongo._mongoClientPromise;
  const db = connectedClient.db('afl_database');
  
  // Cache the connected client and db
  cachedClient = connectedClient;
  cachedDb = db;
  
  console.log('New MongoDB connection established');
  
  // Add event handlers for monitoring
  client.on('serverClosed', () => {
    console.log('MongoDB server connection closed');
    cachedClient = null;
    cachedDb = null;
    globalWithMongo._mongoClientPromise = null;
  });

  return { client: connectedClient, db };
}
// src/app/lib/mongodb.js
import { MongoClient, ServerApiVersion } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;

// Single global instance to prevent connection leaks
class DatabaseConnection {
  constructor() {
    this.client = null;
    this.db = null;
    this.connecting = false;
    this.connectionPromise = null;
  }

  async connect() {
    // Return existing connection if available
    if (this.client && this.db) {
      try {
        // Test connection health
        await this.db.admin().ping();
        return { client: this.client, db: this.db };
      } catch (error) {
        console.warn('Stale connection detected, reconnecting...', error.message);
        this.client = null;
        this.db = null;
      }
    }

    // Wait for existing connection attempt
    if (this.connecting && this.connectionPromise) {
      return await this.connectionPromise;
    }

    // Start new connection
    this.connecting = true;
    this.connectionPromise = this._createConnection();
    
    try {
      const result = await this.connectionPromise;
      this.connecting = false;
      return result;
    } catch (error) {
      this.connecting = false;
      this.connectionPromise = null;
      throw error;
    }
  }

  async _createConnection() {
    if (!MONGODB_URI) {
      throw new Error('Please define the MONGODB_URI environment variable');
    }

    const client = new MongoClient(MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      maxPoolSize: 5,         // Keep low for serverless (Vercel)
      maxIdleTimeMS: 300000,  // 5 minutes
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxConnecting: 5,       // Limit concurrent connections
      waitQueueTimeoutMS: 30000, // Queue timeout
      retryWrites: true,
      retryReads: true
    });

    try {
      await client.connect();
      const db = client.db('afl_database');
      
      // Ensure indexes exist for better performance
      await this._ensureIndexes(db);
      
      this.client = client;
      this.db = db;
      
      // Connection event handlers
      client.on('serverClosed', () => {
        console.log('MongoDB server connection closed');
        this.client = null;
        this.db = null;
      });
      
      client.on('error', (error) => {
        console.error('MongoDB connection error:', error);
        this.client = null;
        this.db = null;
      });
      
      console.log('MongoDB connection established with optimizations');
      return { client: this.client, db: this.db };
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async _ensureIndexes(db) {
    try {
      const currentYear = new Date().getFullYear();
      
      // Common indexes for better query performance
      const indexPromises = [
        // Tips collection
        db.collection(`${currentYear}_tips`).createIndex(
          { Round: 1, User: 1, Active: 1 },
          { background: true, name: 'tips_round_user_active' }
        ),
        db.collection(`${currentYear}_tips`).createIndex(
          { MatchNumber: 1, User: 1, Active: 1 },
          { background: true, name: 'tips_match_user_active' }
        ),
        
        // Team selection
        db.collection(`${currentYear}_team_selection`).createIndex(
          { Round: 1, User: 1, Active: 1 },
          { background: true, name: 'team_round_user_active' }
        ),
        
        // Game results
        db.collection(`${currentYear}_game_results`).createIndex(
          { round: 1 },
          { background: true, name: 'game_results_round' }
        ),
        db.collection(`${currentYear}_game_results`).createIndex(
          { player_name: 1, round: 1 },
          { background: true, name: 'game_results_player_round' }
        ),
        
        // Cache collections
        db.collection(`${currentYear}_tipping_ladder_cache`).createIndex(
          { year: 1, upToRound: 1 },
          { background: true, name: 'cache_year_round' }
        )
      ];
      
      await Promise.allSettled(indexPromises);
      console.log('Database indexes ensured');
    } catch (error) {
      console.warn('Failed to create some indexes:', error.message);
      // Don't fail connection if indexes fail
    }
  }
  
  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}

// Global instance
const dbConnection = new DatabaseConnection();

export async function connectToDatabase() {
  return await dbConnection.connect();
}

// Graceful shutdown
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    await dbConnection.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await dbConnection.close();
    process.exit(0);
  });
}
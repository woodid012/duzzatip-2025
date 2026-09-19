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
    // Return the warm connection straight away. This used to ping Atlas first,
    // which cost every API call a round trip before its real query. The driver
    // already retries reads/writes and the 'error'/'serverClosed' handlers
    // below drop a dead client, so the ping only ever confirmed what the next
    // query would have found out anyway.
    if (this.client && this.db) {
      return { client: this.client, db: this.db };
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

      this.client = client;
      this.db = db;

      // Indexes are ensured in the background: createIndex is a no-op once
      // they exist, but each call is still a round trip, and a cold start was
      // paying for all of them before it could run its first real query.
      // Queries never depended on the index existing, only on it being fast.
      this._ensureIndexes(db).catch(() => {});
      
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
        // Covers the per-round team-list aggregation ($match {Round, Active}),
        // which can't use the User-middle compound index as a prefix.
        db.collection(`${currentYear}_team_selection`).createIndex(
          { Round: 1, Active: 1 },
          { background: true, name: 'team_round_active' }
        ),

        // Game results — keep {round:1} (hot round-only reads) and add compound
        // indexes for the write/merge path (no read-path behaviour change).
        db.collection(`${currentYear}_game_results`).createIndex(
          { round: 1 },
          { background: true, name: 'game_results_round' }
        ),
        db.collection(`${currentYear}_game_results`).createIndex(
          { player_name: 1, round: 1 },
          { background: true, name: 'game_results_player_round' }
        ),
        // Backs the liveOnly merge deleteMany({round, year, team_name}).
        db.collection(`${currentYear}_game_results`).createIndex(
          { year: 1, round: 1, team_name: 1 },
          { background: true, name: 'game_results_year_round_team' }
        ),
        // Backs the "is-stale" findOne({round, year}).sort({created_at:-1}).
        db.collection(`${currentYear}_game_results`).createIndex(
          { year: 1, round: 1, created_at: -1 },
          { background: true, name: 'game_results_year_round_created' }
        ),
        
        // Cache collections
        db.collection(`${currentYear}_tipping_ladder_cache`).createIndex(
          { year: 1, upToRound: 1 },
          { background: true, name: 'cache_year_round' }
        ),
        // Backs the finals-cache findOne({round, year}) and the ladder's
        // per-round and final-totals reads.
        db.collection(`${currentYear}_finals_cache`).createIndex(
          { round: 1, year: 1 },
          { background: true, name: 'finals_cache_round_year' }
        ),
        db.collection(`${currentYear}_final_totals`).createIndex(
          { round: 1, userId: 1 },
          { background: true, name: 'final_totals_round_user' }
        ),
        db.collection(`${currentYear}_simple_round_results`).createIndex(
          { round: 1 },
          { background: true, name: 'simple_round_results_round' }
        ),
        db.collection(`${currentYear}_ladder`).createIndex(
          { round: 1 },
          { background: true, name: 'ladder_round' }
        )
      ];
      
      await Promise.allSettled(indexPromises);
      console.log('Database indexes ensured');
    } catch (error) {
      console.warn('Failed to create some indexes:', error.message);
      // Don't fail connection if indexes fail
    }
  }
  
  // The duzza_finals database never had indexes, so every entries/entrants
  // read was a collection scan. Entries are only ever written by upserts on
  // {Entrant, Round}, so that pair is also made unique: two submits racing
  // past the upsert can no longer leave two docs for one entrant-week.
  async _ensureFinalsIndexes(finalsDb) {
    try {
      const currentYear = new Date().getFullYear();
      await Promise.allSettled([
        finalsDb.collection(`${currentYear}_entries`).createIndex(
          { Entrant: 1, Round: 1 },
          { background: true, unique: true, name: 'entries_entrant_round' }
        ),
        finalsDb.collection(`${currentYear}_entries`).createIndex(
          { Round: 1 },
          { background: true, name: 'entries_round' }
        ),
        finalsDb.collection(`${currentYear}_entrants`).createIndex(
          { EntrantId: 1 },
          { background: true, name: 'entrants_entrant_id' }
        ),
      ]);
    } catch (error) {
      console.warn('Failed to create some finals indexes:', error.message);
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

// Duzza Finals — ring-fenced side comp. Reuses the same singleton client (no
// new connection pool) but points at a separate `duzza_finals` database, so
// afl_database (and _ensureIndexes above) stay completely untouched.
let finalsIndexesEnsured = false;
export async function connectToFinalsDatabase() {
  const { client } = await dbConnection.connect();
  const finalsDb = client.db('duzza_finals');
  if (!finalsIndexesEnsured) {
    finalsIndexesEnsured = true;
    dbConnection._ensureFinalsIndexes(finalsDb).catch(() => {});
  }
  return finalsDb;
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
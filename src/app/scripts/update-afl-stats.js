/**
 * AFL Stats Scraper and Database Updater
 * 
 * This script:
 * 1. Reads fixtures from the public/afl-2025.json file
 * 2. Checks which games have been completed but not yet processed
 * 3. Scrapes game stats from AFL data source 
 * 4. Formats the data and uploads to MongoDB
 * 5. Records processed games to avoid duplicate processing
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;
const CURRENT_YEAR = new Date().getFullYear();
const DB_NAME = 'afl_database';
const GAME_RESULTS_COLLECTION = `${CURRENT_YEAR}_game_results`;
const PROCESSED_GAMES_FILE = path.join(__dirname, 'processed-games.json');

// Get the specific game ID if provided through command line arguments
const specificGameId = process.argv[2] || null;

// Team name mapping (for consistency between different data sources)
const TEAM_NAME_MAP = {
  'Brisbane Lions': 'Brisbane',
  'Gold Coast Suns': 'Gold Coast',
  'West Coast Eagles': 'West Coast',
  'GWS Giants': 'Greater Western Sydney',
  'Sydney Swans': 'Sydney',
  // Add more mappings as needed
};

/**
 * Connect to MongoDB
 */
async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB successfully');
    return client;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

/**
 * Load fixtures data from the public directory
 */
async function loadFixtures() {
  try {
    const fixturesPath = path.join(__dirname, '..', '..', '..', 'public', `afl-${CURRENT_YEAR}.json`);
    const fixturesData = await fs.readFile(fixturesPath, 'utf8');
    return JSON.parse(fixturesData);
  } catch (error) {
    console.error('Failed to load fixtures:', error);
    throw error;
  }
}

/**
 * Load processed games record to avoid duplicate processing
 */
async function loadProcessedGames() {
  try {
    try {
      const data = await fs.readFile(PROCESSED_GAMES_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // If file doesn't exist, create an empty record
      await fs.writeFile(PROCESSED_GAMES_FILE, JSON.stringify([], null, 2));
      return [];
    }
  } catch (error) {
    console.error('Failed to load processed games record:', error);
    return [];
  }
}

/**
 * Save processed games record
 */
async function saveProcessedGames(processedGames) {
  try {
    await fs.writeFile(PROCESSED_GAMES_FILE, JSON.stringify(processedGames, null, 2));
    console.log('Processed games record updated');
  } catch (error) {
    console.error('Failed to save processed games record:', error);
  }
}

/**
 * Check which fixtures need to be processed
 */
async function getFixturesToProcess(fixtures, processedGames) {
  const now = new Date();
  
  // If specific game ID is provided, just process that one
  if (specificGameId) {
    const fixture = fixtures.find(f => f.MatchNumber === parseInt(specificGameId));
    if (fixture) {
      console.log(`Processing specific match: ${fixture.HomeTeam} vs ${fixture.AwayTeam}`);
      return [{
        matchNumber: fixture.MatchNumber,
        round: fixture.RoundNumber,
        homeTeam: standardizeTeamName(fixture.HomeTeam),
        awayTeam: standardizeTeamName(fixture.AwayTeam),
        date: fixture.DateUtc
      }];
    } else {
      console.error(`Match ID ${specificGameId} not found in fixtures`);
      return [];
    }
  }

  // Filter out fixtures that:
  // 1. Have a DateUtc in the past (completed games)
  // 2. Have not been processed yet
  const fixturesToProcess = fixtures.filter(fixture => {
    const gameDate = new Date(fixture.DateUtc);
    // Add 3 hours to game date to account for game duration
    gameDate.setHours(gameDate.getHours() + 3);
    
    // If the game is in the past and hasn't been processed yet
    return gameDate < now && !processedGames.includes(fixture.MatchNumber);
  });

  console.log(`Found ${fixturesToProcess.length} fixtures to process`);
  return fixturesToProcess.map(fixture => ({
    matchNumber: fixture.MatchNumber,
    round: fixture.RoundNumber,
    homeTeam: standardizeTeamName(fixture.HomeTeam),
    awayTeam: standardizeTeamName(fixture.AwayTeam),
    date: fixture.DateUtc
  }));
}

/**
 * Standardize team names for consistency
 */
function standardizeTeamName(teamName) {
  return TEAM_NAME_MAP[teamName] || teamName;
}

// Import the separate stats parser module
const statsParser = require('./afl-stats-parser');

/**
 * Scrape game stats from AFL data source
 */
async function scrapeGameStats(fixture) {
  try {
    console.log(`Scraping stats for match: ${fixture.homeTeam} vs ${fixture.awayTeam}`);
    
    // Use the dedicated parser to get match stats
    // Last parameter true = use demo data (change to false when connecting to real data source)
    const matchStats = await statsParser.getMatchStats(fixture, true);
    
    return matchStats;
  } catch (error) {
    console.error(`Failed to scrape stats for match ${fixture.matchNumber}:`, error);
    return [];
  }
}

/**
 * Upload stats to MongoDB
 */
async function uploadStatsToMongoDB(client, stats, fixture) {
  try {
    if (!stats || stats.length === 0) {
      console.log('No stats to upload');
      return false;
    }
    
    const db = client.db(DB_NAME);
    const collection = db.collection(GAME_RESULTS_COLLECTION);

    // First, check if stats for this match already exist
    const existingStats = await collection.findOne({ 
      round: fixture.round,
      match_number: fixture.matchNumber
    });
    
    if (existingStats) {
      console.log(`Stats for match ${fixture.matchNumber} already exist in MongoDB`);
      return false;
    }

    // Ensure all stats have round info
    const enrichedStats = stats.map(stat => ({
      ...stat,
      round: fixture.round,
      match_number: fixture.matchNumber,
      match_date: new Date(fixture.date),
      year: CURRENT_YEAR
    }));

    // Insert all stats as individual documents
    const result = await collection.insertMany(enrichedStats);
    console.log(`Inserted ${result.insertedCount} player stats into MongoDB`);
    return true;
  } catch (error) {
    console.error('Failed to upload stats to MongoDB:', error);
    return false;
  }
}

/**
 * Main function to process fixtures
 */
async function main() {
  let mongoClient;
  let processedAny = false;
  
  try {
    // Connect to MongoDB
    mongoClient = await connectToMongoDB();
    
    // Load fixtures and processed games record
    const fixtures = await loadFixtures();
    const processedGames = await loadProcessedGames();
    
    // Determine which fixtures need to be processed
    const fixturesToProcess = await getFixturesToProcess(fixtures, processedGames);
    
    if (fixturesToProcess.length === 0) {
      console.log('No new fixtures to process');
      return;
    }
    
    // Process each fixture
    for (const fixture of fixturesToProcess) {
      console.log(`Processing fixture: Round ${fixture.round}, Match ${fixture.matchNumber}`);
      
      // Scrape stats for the fixture
      const stats = await scrapeGameStats(fixture);
      
      if (stats.length > 0) {
        // Upload stats to MongoDB
        const success = await uploadStatsToMongoDB(mongoClient, stats, fixture);
        
        if (success) {
          // Add the fixture to processed games record
          processedGames.push(fixture.matchNumber);
          await saveProcessedGames(processedGames);
          console.log(`Fixture ${fixture.matchNumber} processed successfully`);
          processedAny = true;
        }
      } else {
        console.log(`No stats found for fixture ${fixture.matchNumber}`);
      }
    }
    
    // Flag for GitHub Actions to know if we made changes
    if (processedAny) {
      console.log('PROCESSED_FIXTURES=true');
    } else {
      console.log('PROCESSED_FIXTURES=false');
    }
  } catch (error) {
    console.error('Error in main process:', error);
    process.exit(1);
  } finally {
    // Close MongoDB connection
    if (mongoClient) {
      await mongoClient.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
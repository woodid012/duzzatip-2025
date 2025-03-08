/**
 * Script to update AFL stats after games finish
 * 
 * This script:
 * 1. Reads the fixtures file to find today's games
 * 2. Checks if any games have finished (start time + 3 hours)
 * 3. Downloads stats for those games from DFS Australia
 * 4. Updates MongoDB with the stats data
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";
const DB_NAME = 'afl_database';
const CURRENT_YEAR = new Date().getFullYear();
const COLLECTION_NAME = `${CURRENT_YEAR}_game_results`;

// Track processed games to avoid duplicate processing
const PROCESSED_GAMES_FILE = path.join(__dirname, 'processed-games.json');

// URL for the DFS Australia AFL stats
const DFS_STATS_URL = 'https://dfsaustralia.com/wp-admin/admin-ajax.php';

// Add a User-Agent header to mimic a browser
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

// Game duration in milliseconds (3 hours)
const GAME_DURATION_MS = 3 * 60 * 60 * 1000;

/**
 * Connect to MongoDB
 */
async function connectToDatabase() {
  try {
    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('Connected to MongoDB successfully');
    return { client, db: client.db(DB_NAME) };
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

/**
 * Load fixtures from the file
 */
async function loadFixtures() {
  try {
    // Navigate up from scripts directory to project root
    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    const fixturesPath = path.join(projectRoot, 'public', `afl-${CURRENT_YEAR}.json`);
    
    // Read fixtures file
    const fixturesData = await fs.readFile(fixturesPath, 'utf8');
    return JSON.parse(fixturesData);
  } catch (error) {
    console.error('Error loading fixtures:', error);
    
    // Try to fetch fixtures from API as fallback
    console.log('Attempting to fetch fixtures from API...');
    try {
      const response = await axios.get(`https://fixturedownload.com/feed/json/afl-${CURRENT_YEAR}`);
      return response.data;
    } catch (fetchError) {
      console.error('Failed to fetch fixtures from API:', fetchError);
      throw error;
    }
  }
}

/**
 * Load the list of already processed games
 */
async function loadProcessedGames() {
  try {
    const data = await fs.readFile(PROCESSED_GAMES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist or is invalid, return empty array
    return [];
  }
}

/**
 * Save the updated list of processed games
 */
async function saveProcessedGames(processedGames) {
  try {
    await fs.writeFile(PROCESSED_GAMES_FILE, JSON.stringify(processedGames, null, 2));
  } catch (error) {
    console.error('Error saving processed games:', error);
  }
}

/**
 * Check if there are any games that finished recently and need stats updated
 */
async function findGamesToUpdate(fixtures, processedGames) {
  const now = new Date();
  
  // Get all games that have a DateUtc field
  const allGames = fixtures.filter(game => game.DateUtc);
  
  // Find games that should have finished by now but haven't been processed
  const gamesToUpdate = allGames.filter(game => {
    // Parse game date
    const gameDate = new Date(game.DateUtc);
    
    // Calculate expected end time (game start + 3 hours)
    const gameEndTime = new Date(gameDate.getTime() + GAME_DURATION_MS);
    
    // Check if game has finished and not been processed yet
    const hasFinished = gameEndTime <= now;
    const isProcessed = processedGames.includes(game.MatchNumber);
    
    return hasFinished && !isProcessed;
  });
  
  return gamesToUpdate;
}

/**
 * Download AFL stats from DFS Australia
 * The API returns all season stats to date, not just specific rounds
 */
async function downloadAFLStats() {
  try {
    console.log('Downloading all AFL stats for the season to date...');
    
    // Use URLSearchParams to format data correctly
    const params = new URLSearchParams({
      action: 'afl_player_stats_download_call_mysql'
    });
    
    // Make POST request to fetch the stats data
    const response = await axios.post(DFS_STATS_URL, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        'Origin': 'https://dfsaustralia.com',
        'Referer': 'https://dfsaustralia.com/afl-stats-download/'
      }
    });
    
    // Log the response for debugging
    console.log('Response status:', response.status);
    
    if (!response.data) {
      console.error('Empty response data');
      throw new Error('Empty response data from DFS Australia');
    }
    
    // Handle the case where data is directly in response.data
    let playerData;
    
    if (Array.isArray(response.data.data)) {
      // The expected format with data inside a data property
      playerData = response.data.data;
      console.log(`Downloaded ${playerData.length} player records (standard format)`);
    } else if (response.data.data && typeof response.data.data === 'string') {
      // Sometimes data might be a JSON string that needs parsing
      try {
        playerData = JSON.parse(response.data.data);
        console.log(`Downloaded ${playerData.length} player records (parsed from string)`);
      } catch (e) {
        console.error('Error parsing data string:', e);
        throw new Error('Failed to parse player data string');
      }
    } else if (Array.isArray(response.data)) {
      // Direct array in response
      playerData = response.data;
      console.log(`Downloaded ${playerData.length} player records (direct array)`);
    } else {
      console.error('Unexpected response format:', JSON.stringify(response.data).substring(0, 500));
      throw new Error('Failed to extract player data: unknown format');
    }
    
    return playerData;
  } catch (error) {
    console.error('Error downloading AFL stats:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      console.error('Response data:', JSON.stringify(error.response.data).substring(0, 500));
    } else if (error.request) {
      console.error('No response received from server');
    }
    throw error;
  }
}

/**
 * Process the downloaded stats data
 */
function processStatsData(data) {
  return data.map(record => {
    // Ensure we have a valid record to process
    if (!record || typeof record !== 'object') {
      console.warn('Invalid record found:', record);
      return null;
    }
    
    // Map the field names to match our MongoDB schema
    return {
      player_name: record.player || '',
      team_name: record.team || '',
      opp: record.opponent || '',
      round: parseInt(record.round, 10) || 0,
      year: parseInt(record.year, 10) || CURRENT_YEAR,
      match_date: record.date || new Date().toISOString().split('T')[0],
      
      // Stats from DFS Australia format
      kicks: parseInt(record.kicks, 10) || 0,
      handballs: parseInt(record.handballs, 10) || 0,
      disposals: (parseInt(record.kicks, 10) || 0) + (parseInt(record.handballs, 10) || 0),
      marks: parseInt(record.marks, 10) || 0,
      tackles: parseInt(record.tackles, 10) || 0,
      hitouts: parseInt(record.hitouts, 10) || 0,
      ruckContests: parseInt(record.ruckContests, 10) || 0,
      freesFor: parseInt(record.freesFor, 10) || 0,
      freesAgainst: parseInt(record.freesAgainst, 10) || 0,
      goals: parseInt(record.goals, 10) || 0,
      behinds: parseInt(record.behinds, 10) || 0,
      centreBounceAttendances: parseInt(record.cbas, 10) || 0,
      kickIns: parseInt(record.kickins, 10) || 0,
      kickInsPlayon: parseInt(record.kickinsPlayon, 10) || 0,
      timeOnGroundPercentage: parseInt(record.tog, 10) || 0,
      
      // Fantasy points
      dreamTeamPoints: parseInt(record.fantasyPoints, 10) || 0,
      SC: parseInt(record.superCoachPoints, 10) || 0,
      
      // Add extra fields
      match_number: record.matchNumber || 100 + (parseInt(record.round, 10) || 0),
      startingPosition: record.namedPosition || '',
      created_at: new Date()
    };
  }).filter(record => record !== null); // Remove any invalid records
}

/**
 * Update MongoDB with player stats
 */
async function updateDatabase(db, data, rounds) {
  try {
    if (!data || data.length === 0) {
      console.log('No data to update');
      return { insertedCount: 0, rounds };
    }
    
    const collection = db.collection(COLLECTION_NAME);
    
    // Process data to match our schema
    const formattedData = processStatsData(data);
    
    // If we have specific rounds to update
    if (rounds && rounds.length > 0) {
      console.log(`Removing existing data for round(s) ${rounds.join(', ')}...`);
      await collection.deleteMany({
        round: { $in: rounds },
        year: CURRENT_YEAR
      });
    }
    
    // Insert new data
    console.log(`Inserting ${formattedData.length} player records...`);
    const result = await collection.insertMany(formattedData);
    
    console.log(`Successfully inserted ${result.insertedCount} records`);
    return {
      insertedCount: result.insertedCount,
      rounds
    };
  } catch (error) {
    console.error('Database update error:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  let client;
  let processedFixtures = false;
  
  try {
    console.log('Starting AFL stats update...');
    
    // Get the fixtures
    const fixtures = await loadFixtures();
    
    // Get the list of games we've already processed
    const processedGames = await loadProcessedGames();
    
    // Find all games that have finished recently and need stats updated
    const gamesToUpdate = await findGamesToUpdate(fixtures, processedGames);
    
    if (gamesToUpdate.length === 0) {
      console.log('No games to update at this time');
      // Create a temporary output file for GitHub Actions to read
      await fs.writeFile('/tmp/script_output.txt', 'PROCESSED_FIXTURES=false');
      return;
    }
    
    console.log(`Found ${gamesToUpdate.length} games to update:`, 
      gamesToUpdate.map(game => `Game ${game.MatchNumber} (Round ${game.RoundNumber})`).join(', '));
    
    // Get unique rounds from the games to update
    const roundsToUpdate = [...new Set(gamesToUpdate.map(game => parseInt(game.RoundNumber, 10)))];
    
    // Download ALL stats (the API returns the entire season to date)
    const allStatsData = await downloadAFLStats();
    
    // Filter for just the rounds we care about
    const relevantStatsData = allStatsData.filter(record => {
      const recordRound = parseInt(record.round, 10);
      return roundsToUpdate.includes(recordRound);
    });
    
    console.log(`Downloaded ${allStatsData.length} total player stats, filtered to ${relevantStatsData.length} records for rounds ${roundsToUpdate.join(', ')}`);
    
    // Connect to database
    const { client: dbClient, db } = await connectToDatabase();
    client = dbClient;
    
    // Update database with the data
    const result = await updateDatabase(db, relevantStatsData, roundsToUpdate);
    
    // Mark these games as processed
    const newProcessedGames = [...processedGames];
    gamesToUpdate.forEach(game => {
      if (!newProcessedGames.includes(game.MatchNumber)) {
        newProcessedGames.push(game.MatchNumber);
      }
    });
    await saveProcessedGames(newProcessedGames);
    
    console.log('=== SUCCESS ===');
    console.log(`Updated ${result.insertedCount} player records`);
    console.log(`Rounds affected: ${result.rounds.join(', ')}`);
    console.log(`Games processed: ${gamesToUpdate.map(g => g.MatchNumber).join(', ')}`);
    
    // Signal to GitHub Actions that we processed fixtures
    processedFixtures = true;
    console.log('PROCESSED_FIXTURES=true');
    
    // Create a temporary output file for GitHub Actions to read
    await fs.writeFile('/tmp/script_output.txt', 'PROCESSED_FIXTURES=true');
    
  } catch (error) {
    console.error('Error in main process:', error);
    console.log('PROCESSED_FIXTURES=false');
    
    // Create a temporary output file for GitHub Actions to read
    await fs.writeFile('/tmp/script_output.txt', 'PROCESSED_FIXTURES=false');
    
    process.exit(1);
  } finally {
    // Close database connection
    if (client) {
      await client.close();
      console.log('Database connection closed');
    }
  }
}

// Run the main function
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
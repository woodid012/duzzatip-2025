/**
 * AFL Stats Scraper and Database Updater
 * 
 * This script:
 * 1. Reads fixtures from the public/afl-2025.json file
 * 2. Checks which games have been completed but not yet processed
 * 3. Scrapes game stats from dfsaustralia.com 
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
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://dbwooding88:HUz1BwQHnDjKJPjC@duzzatip.ohjmn.mongodb.net/?retryWrites=true&w=majority&appName=Duzzatip";
const CURRENT_YEAR = new Date().getFullYear();
const MONGODB_COLLECTION = `${CURRENT_YEAR}_test`;
const PROCESSED_GAMES_FILE = path.join(__dirname, 'processed-games.json');

// Get the specific game ID if provided through command line arguments
const specificGameId = process.argv[2] || null;

/**
 * Connect to MongoDB
 */
async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
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
    console.log(`Processing specific game ID: ${specificGameId}`);
    return [{ gameId: parseInt(specificGameId) }];
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
    gameId: 6964 + fixture.MatchNumber, // Assuming game IDs start at 6965 for game 1
    matchNumber: fixture.MatchNumber,
    round: fixture.RoundNumber,
    homeTeam: fixture.HomeTeam,
    awayTeam: fixture.AwayTeam
  }));
}

/**
 * Scrape game stats from dfsaustralia.com
 */
async function scrapeGameStats(gameId) {
  try {
    console.log(`Scraping stats for game ID: ${gameId}`);
    const url = `https://dfsaustralia.com/afl-game-stats/?gameId=${gameId}`;
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    
    // Get game information
    const gameInfoText = $('.afl-stats-header h4').text().trim();
    // Parse out team names, e.g. "Gold Coast vs West Coast"
    const teamMatch = gameInfoText.match(/(.+)\s+vs\s+(.+)/);
    const homeTeam = teamMatch ? teamMatch[1].trim() : '';
    const awayTeam = teamMatch ? teamMatch[2].trim() : '';
    
    // Extract match date if available
    let matchDate = new Date();
    const dateText = $('.afl-stats-header p').text().trim();
    if (dateText) {
      // Try to parse the date
      try {
        // Format is typically like "Mar 31, 2025"
        matchDate = new Date(dateText);
      } catch (e) {
        console.warn('Could not parse date:', dateText);
      }
    }
    
    const playerStats = [];
    
    // Extract player stats from the table
    $('.afl-stats-table tbody tr').each((i, row) => {
      const $cells = $(row).find('td');
      
      // Skip if not enough cells (some rows might be headers or empty)
      if ($cells.length < 10) return;
      
      // Extract the team name and player name
      const playerName = $($cells[0]).text().trim();
      // Determine team based on row background color or other indicators
      // This is a simplification; you might need to adjust based on actual page structure
      const teamName = $($cells[1]).text().trim() || homeTeam; // Default to home team if not specified
      
      // Extract individual stats
      const stats = {
        player_name: playerName,
        team_name: teamName,
        opp: teamName === homeTeam ? awayTeam : homeTeam,
        kicks: parseInt($($cells[2]).text().trim()) || 0,
        handballs: parseInt($($cells[3]).text().trim()) || 0,
        disposals: parseInt($($cells[4]).text().trim()) || 0,
        marks: parseInt($($cells[5]).text().trim()) || 0,
        tackles: parseInt($($cells[6]).text().trim()) || 0,
        hitouts: parseInt($($cells[7]).text().trim()) || 0,
        goals: parseInt($($cells[8]).text().trim()) || 0,
        behinds: parseInt($($cells[9]).text().trim()) || 0,
        centreBounceAttendances: parseInt($($cells[10]).text().trim()) || 0,
        kickIns: parseInt($($cells[11]).text().trim()) || 0,
        kickInsPlayon: parseInt($($cells[12]).text().trim()) || 0,
        timeOnGroundPercentage: parseInt($($cells[13]).text().trim()) || 0,
        dreamTeamPoints: parseInt($($cells[14]).text().trim()) || 0,
        SC: parseInt($($cells[15]).text().trim()) || 0,
        round: parseInt($('.afl-stats-header h3').text().replace('Round', '').trim()) || 0,
        year: CURRENT_YEAR,
        game_id: gameId
      };
      
      playerStats.push(stats);
    });
    
    return playerStats;
  } catch (error) {
    console.error(`Failed to scrape stats for game ID ${gameId}:`, error);
    return [];
  }
}

/**
 * Upload stats to MongoDB
 */
async function uploadStatsToMongoDB(client, stats, gameInfo) {
  try {
    if (!stats || stats.length === 0) {
      console.log('No stats to upload');
      return false;
    }
    
    const db = client.db('afl_database');
    const collection = db.collection(MONGODB_COLLECTION);

    // First, check if stats for this game already exist
    const existingStats = await collection.findOne({ game_id: gameInfo.gameId });
    if (existingStats) {
      console.log(`Stats for game ID ${gameInfo.gameId} already exist in MongoDB`);
      return false;
    }

    // Ensure all stats have round and year info
    const enrichedStats = stats.map(stat => ({
      ...stat,
      round: gameInfo.round || stat.round,
      year: CURRENT_YEAR,
      game_id: gameInfo.gameId
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
      console.log(`Processing fixture: ${JSON.stringify(fixture)}`);
      
      // Scrape stats for the fixture
      const stats = await scrapeGameStats(fixture.gameId);
      
      if (stats.length > 0) {
        // Upload stats to MongoDB
        const success = await uploadStatsToMongoDB(mongoClient, stats, fixture);
        
        if (success) {
          // Add the fixture to processed games record
          processedGames.push(fixture.matchNumber);
          await saveProcessedGames(processedGames);
          console.log(`Fixture ${fixture.matchNumber} processed successfully`);
        }
      } else {
        console.log(`No stats found for fixture ${fixture.matchNumber}`);
      }
    }
  } catch (error) {
    console.error('Error in main process:', error);
  } finally {
    // Close MongoDB connection
    if (mongoClient) {
      await mongoClient.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the main function
main().catch(console.error);

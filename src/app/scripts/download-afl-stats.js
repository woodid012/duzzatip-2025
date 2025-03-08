/**
 * Download AFL Stats Script
 * 
 * Downloads AFL stats Excel file from DFS Australia website,
 * parses it and updates the MongoDB database collection.
 * 
 * Run with: node download-afl-stats.js
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const XLSX = require('xlsx');
const { MongoClient } = require('mongodb');

// Config variables
const MONGODB_URI = process.env.MONGODB_URI;
const CURRENT_YEAR = new Date().getFullYear();
const DB_NAME = 'afl_database';
const COLLECTION_NAME = `${CURRENT_YEAR}_game_results`;
const AFL_STATS_URL = 'https://dfsaustralia.com/afl-stats-download/';

// Set to true to save the downloaded files for debugging
const SAVE_FILES = false;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

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
 * Fetch the download link from the DFS Australia website
 */
async function fetchDownloadLink() {
  try {
    console.log(`Fetching page from ${AFL_STATS_URL}`);
    const response = await axios.get(AFL_STATS_URL);
    
    // Parse HTML with Cheerio
    const $ = cheerio.load(response.data);
    
    // Look for the link containing "click here"
    const downloadLink = $('a:contains("click here")').attr('href');
    
    if (!downloadLink) {
      throw new Error('Could not find the stats download link on the page');
    }
    
    console.log(`Found download link: ${downloadLink}`);
    return downloadLink;
  } catch (error) {
    console.error('Error fetching download link:', error);
    throw error;
  }
}

/**
 * Download and parse the Excel file
 */
async function downloadAndParseExcel(url) {
  try {
    console.log(`Downloading file from ${url}`);
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const data = Buffer.from(response.data);
    
    // Save file for debugging if needed
    if (SAVE_FILES) {
      try {
        await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
        const filename = `aflstats_${new Date().toISOString().replace(/[:.]/g, '_')}.xlsx`;
        const filePath = path.join(DOWNLOADS_DIR, filename);
        await fs.writeFile(filePath, data);
        console.log(`File saved to: ${filePath}`);
      } catch (saveError) {
        console.warn('Failed to save file:', saveError);
      }
    }
    
    // Parse Excel file
    console.log('Parsing Excel file...');
    const workbook = XLSX.read(data, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Log some debug info about the sheet
    console.log(`Sheet name: ${sheetName}`);
    console.log(`Sheet range: ${sheet['!ref']}`);
    
    // Convert to JSON
    const jsonData = XLSX.utils.sheet_to_json(sheet);
    
    if (!jsonData || jsonData.length === 0) {
      throw new Error('No data found in the Excel file');
    }
    
    console.log(`Parsed ${jsonData.length} rows from Excel file`);
    
    // Log a sample row to help with debugging
    console.log('Sample row:', JSON.stringify(jsonData[0], null, 2));
    
    return jsonData;
  } catch (error) {
    console.error('Error downloading or parsing Excel file:', error);
    throw error;
  }
}

/**
 * Format player data for database insertion
 */
function formatPlayerData(row) {
  // Detect and normalize column names since they might vary
  const getValueByPossibleNames = (names) => {
    for (const name of names) {
      if (row[name] !== undefined) return row[name];
    }
    return null;
  };
  
  // Try to extract round number
  const round = parseInt(getValueByPossibleNames(['Round', 'round', 'RD', 'Rd'])) || 0;
  
  // Extract player and team names
  const playerName = getValueByPossibleNames(['Player', 'player', 'PLAYER', 'Name', 'name']) || 'Unknown Player';
  const teamName = getValueByPossibleNames(['Team', 'team', 'TEAM', 'Club', 'club']) || 'Unknown Team';
  const opponent = getValueByPossibleNames(['Opponent', 'opponent', 'OPP', 'Opposition', 'Vs']) || '';
  
  // Format date if available
  let matchDate = new Date();
  const dateValue = getValueByPossibleNames(['Date', 'date', 'DATE', 'Game Date', 'Match Date']);
  if (dateValue) {
    try {
      matchDate = new Date(dateValue);
      if (isNaN(matchDate.getTime())) matchDate = new Date(); // Use current date if parsing fails
    } catch (e) {
      console.warn(`Failed to parse date: ${dateValue}`);
    }
  }
  
  // Create formatted object for database
  return {
    player_name: playerName,
    team_name: teamName,
    opp: opponent,
    round: round,
    year: CURRENT_YEAR,
    match_date: matchDate,
    
    // Game stats - convert to numbers where needed
    kicks: parseInt(getValueByPossibleNames(['Kicks', 'kicks', 'K', 'kick'])) || 0,
    handballs: parseInt(getValueByPossibleNames(['Handballs', 'handballs', 'HB', 'handball'])) || 0,
    disposals: parseInt(getValueByPossibleNames(['Disposals', 'disposals', 'D', 'disposal'])) || 0,
    marks: parseInt(getValueByPossibleNames(['Marks', 'marks', 'M', 'mark'])) || 0,
    tackles: parseInt(getValueByPossibleNames(['Tackles', 'tackles', 'T', 'tackle'])) || 0,
    hitouts: parseInt(getValueByPossibleNames(['Hitouts', 'hitouts', 'HO', 'Hit Outs'])) || 0,
    goals: parseInt(getValueByPossibleNames(['Goals', 'goals', 'G', 'goal'])) || 0,
    behinds: parseInt(getValueByPossibleNames(['Behinds', 'behinds', 'B', 'behind'])) || 0,
    
    // Extended stats (if available)
    centreBounceAttendances: parseInt(getValueByPossibleNames(['CBA', 'Centre Bounce Attendances', 'Centre Bounces'])) || 0,
    kickIns: parseInt(getValueByPossibleNames(['Kick Ins', 'kick_ins', 'KI'])) || 0,
    kickInsPlayon: parseInt(getValueByPossibleNames(['Kick Ins Play On', 'KI Play On'])) || 0,
    timeOnGroundPercentage: parseFloat(getValueByPossibleNames(['TOG', 'TOG%', 'Time on Ground %', 'Time on Ground'])) || 0,
    
    // Fantasy scores
    dreamTeamPoints: parseInt(getValueByPossibleNames(['DT', 'Fantasy', 'AFL Fantasy', 'fantasy_points'])) || 0,
    SC: parseInt(getValueByPossibleNames(['SC', 'SuperCoach', 'supercoach_points'])) || 0,
    
    // Additional fields if available
    contested_possessions: parseInt(getValueByPossibleNames(['CP', 'Contested Possessions'])) || 0,
    uncontested_possessions: parseInt(getValueByPossibleNames(['UP', 'Uncontested Possessions'])) || 0,
    inside_50s: parseInt(getValueByPossibleNames(['I50', 'Inside 50s'])) || 0,
    clearances: parseInt(getValueByPossibleNames(['CL', 'Clearances'])) || 0,
    
    // Match identification
    match_number: parseInt(getValueByPossibleNames(['MatchID', 'Match Number', 'Game ID'])) || 0,
    
    // Add timestamp for when record was created
    created_at: new Date()
  };
}

/**
 * Upload data to MongoDB
 */
async function uploadToMongoDB(client, data) {
  try {
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    // Format the data for MongoDB
    const formattedData = data.map(row => formatPlayerData(row));
    
    // Get unique rounds in the data
    const roundsToUpdate = [...new Set(formattedData.map(item => item.round))].filter(r => r > 0);
    
    if (roundsToUpdate.length === 0) {
      console.log('Warning: No valid round numbers found in data');
    } else {
      console.log(`Found data for round(s): ${roundsToUpdate.join(', ')}`);
      
      // Remove existing data for these rounds to avoid duplicates
      console.log(`Clearing existing data for rounds: ${roundsToUpdate.join(', ')}`);
      await collection.deleteMany({ 
        round: { $in: roundsToUpdate },
        year: CURRENT_YEAR
      });
    }
    
    // Insert new data
    console.log(`Inserting ${formattedData.length} player stats records...`);
    const result = await collection.insertMany(formattedData);
    
    console.log(`Successfully inserted ${result.insertedCount} records`);
    return {
      insertedCount: result.insertedCount,
      rounds: roundsToUpdate
    };
  } catch (error) {
    console.error('Error uploading to MongoDB:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  let mongoClient;
  
  try {
    // Step 1: Get the download link from the website
    const downloadLink = await fetchDownloadLink();
    
    // Step 2: Download and parse the Excel file
    const parsedData = await downloadAndParseExcel(downloadLink);
    
    // Step 3: Connect to MongoDB
    mongoClient = await connectToMongoDB();
    
    // Step 4: Upload the data to MongoDB
    const result = await uploadToMongoDB(mongoClient, parsedData);
    
    // Output in format recognized by GitHub Actions
    console.log('PROCESSED_FIXTURES=true');
    
    // Final success message
    console.log(`AFL stats update completed successfully with ${result.insertedCount} records for rounds: ${result.rounds.join(', ')}`);
    
  } catch (error) {
    console.error('Error in main process:', error);
    console.log('PROCESSED_FIXTURES=false');
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

/**
 * Script to fetch AFL stats from DFS Australia and update MongoDB
 * 
 * This script downloads real AFL stats from DFS Australia website
 * and updates the MongoDB database with the real data
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');

// Configuration
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is required');
}
const DB_NAME = 'afl_database';
const CURRENT_YEAR = new Date().getFullYear();
const COLLECTION_NAME = `${CURRENT_YEAR}_game_results`;

// Save downloaded data for reference
const SAVE_FILES = true;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// URL for the DFS Australia AFL stats
const DFS_STATS_URL = 'https://dfsaustralia.com/wp-admin/admin-ajax.php';

// Add a User-Agent header to mimic a browser
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

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
 * Download AFL stats from DFS Australia
 */
async function downloadAFLStats() {
  try {
    console.log('Downloading AFL stats from DFS Australia...');
    
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
    console.log('Response data structure:', Object.keys(response.data));
    
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
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      console.error('Response data:', JSON.stringify(error.response.data).substring(0, 500));
    } else if (error.request) {
      // The request was made but no response was received
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
    
    const roundNumber = parseInt(record.round, 10) || 0;
    
    // Map the field names to match our MongoDB schema
    return {
      player_name: record.player || '',
      team_name: record.team || '',
      opp: record.opponent || '',
      round: roundNumber,
      year: parseInt(record.year, 10) || CURRENT_YEAR,
      match_date: new Date().toISOString().split('T')[0], // We don't have match date in the data
      
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
      match_number: 100 + roundNumber, // Generate a match number based on the modified round
      startingPosition: record.namedPosition || '',
      created_at: new Date()
    };
  }).filter(record => record !== null); // Remove any invalid records
}

/**
 * Save downloaded data as CSV
 */
async function saveDataAsCSV(data) {
  try {
    if (!SAVE_FILES) return null;
    
    await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
    
    // Format headers and data like DFS Australia's format
    const csvRows = [];
    const titleRow = ["Stats downloaded from DuzzaTip Script"];
    csvRows.push(titleRow.join(','));
    
    const blankRow = [""];
    csvRows.push(blankRow.join(','));
    
    // Use the headers from the DFS Australia site
    const headers = [
      "player", "team", "opponent", "year", "round", "kicks", "handballs", 
      "marks", "tackles", "hitouts", "ruckContests", "freesFor", "freesAgainst", 
      "goals", "behinds", "cbas", "kickins", "kickinsPlayon", "tog", 
      "fantasyPoints", "superCoachPoints", "namedPosition"
    ];
    csvRows.push(headers.join(','));
    
    // Format each data row for original raw data
    data.forEach(item => {
      // Skip if item is not an object
      if (!item || typeof item !== 'object') return;
      
      try {
        const rowStat = [
          item.player || '', 
          item.team || '', 
          item.opponent || '', 
          item.year || '', 
          item.round || '', 
          item.kicks || '', 
          item.handballs || '', 
          item.marks || '', 
          item.tackles || '', 
          item.hitouts || '', 
          item.ruckContests || '0', 
          item.freesFor || '0', 
          item.freesAgainst || '0', 
          item.goals || '', 
          item.behinds || '', 
          item.cbas || '', 
          item.kickins || '', 
          item.kickinsPlayon || '', 
          item.tog || '', 
          item.fantasyPoints || '', 
          item.superCoachPoints || '', 
          item.namedPosition || ''
        ];
        csvRows.push(rowStat.join(','));
      } catch (e) {
        console.warn('Error formatting row for CSV:', e);
      }
    });
    
    const csvContent = csvRows.join('\n');
    const filename = `aflstats_real_${new Date().toISOString().replace(/:/g, '-')}.csv`;
    const filePath = path.join(DOWNLOADS_DIR, filename);
    
    await fs.writeFile(filePath, csvContent);
    console.log(`Downloaded data saved as CSV to: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Error saving data as CSV:', error);
    return null;
  }
}

/**
 * Update MongoDB with player stats
 */
async function updateDatabase(db, data) {
  try {
    const collection = db.collection(COLLECTION_NAME);
    
    // Process data to match our schema
    const formattedData = processStatsData(data);
    
    // Get rounds included in this update - include round 0 as valid
    const rounds = [...new Set(formattedData.map(item => item.round))];
    
    if (rounds.length === 0) {
      console.log('Warning: No round numbers detected in data');
    } else {
      console.log(`Found data for round(s): ${rounds.join(', ')}`);
      
      // Remove existing data for these rounds
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
  
  try {
    console.log('Starting AFL stats processing...');
    
    // Download real AFL stats from DFS Australia
    const aflStatsData = await downloadAFLStats();
    
    // Save as CSV for reference
    const csvPath = await saveDataAsCSV(aflStatsData);
    
    // Connect to database
    const { client: dbClient, db } = await connectToDatabase();
    client = dbClient;
    
    // Update database with real data
    const result = await updateDatabase(db, aflStatsData);
    
    console.log('=== SUCCESS ===');
    console.log(`Updated ${result.insertedCount} player records`);
    console.log(`Rounds affected: ${result.rounds.join(', ')}`);
    if (csvPath) {
      console.log(`CSV file saved at: ${csvPath}`);
    }
    
    // Signal to GitHub Actions
    console.log('PROCESSED_FIXTURES=true');
    
  } catch (error) {
    console.error('Error in main process:', error);
    console.log('PROCESSED_FIXTURES=false');
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
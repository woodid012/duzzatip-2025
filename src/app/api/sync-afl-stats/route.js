import { NextResponse } from 'next/server';
import axios from 'axios';
import cheerio from 'cheerio';
import XLSX from 'xlsx';
import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function POST() {
  try {
    console.log('Starting AFL stats sync process...');
    
    // Step 1: Fetch the HTML page to get the download link
    const pageUrl = 'https://dfsaustralia.com/afl-stats-download/';
    console.log(`Fetching page from ${pageUrl}`);
    const pageResponse = await axios.get(pageUrl);
    
    // Step 2: Extract the Excel file URL using Cheerio
    const $ = cheerio.load(pageResponse.data);
    const downloadLink = $('a:contains("click here")').attr('href');
    
    if (!downloadLink) {
      throw new Error('Could not find the Excel file download link');
    }
    
    console.log(`Found download link: ${downloadLink}`);
    
    // Step 3: Download the Excel file
    const excelResponse = await axios.get(downloadLink, { 
      responseType: 'arraybuffer' 
    });
    const data = Buffer.from(excelResponse.data);
    
    // Step 4: Parse the Excel file
    console.log('Parsing Excel file...');
    const workbook = XLSX.read(data, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet);
    
    if (!jsonData || jsonData.length === 0) {
      throw new Error('No data found in the Excel file');
    }
    
    console.log(`Extracted ${jsonData.length} player stats records`);
    
    // Step 5: Format data for MongoDB
    const formattedData = jsonData.map(row => formatPlayerData(row));
    
    // Step 6: Store in MongoDB
    console.log('Connecting to database...');
    const { db } = await connectToDatabase();
    const collection = db.collection(`${CURRENT_YEAR}_game_results`);
    
    // Clear existing data for current rounds (if updating)
    const roundsToUpdate = [...new Set(formattedData.map(item => item.round))];
    if (roundsToUpdate.length > 0) {
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
    return NextResponse.json({ 
      message: 'AFL stats synced successfully',
      insertedCount: result.insertedCount,
      rounds: roundsToUpdate
    });
    
  } catch (error) {
    console.error('Error syncing AFL stats:', error);
    return NextResponse.json(
      { error: 'Failed to sync AFL stats', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Format player data from Excel row to database format
 */
function formatPlayerData(row) {
  // Check for required fields and provide defaults for missing ones
  const round = parseInt(row.Round) || 0;
  const playerName = row.Player || 'Unknown Player';
  const teamName = row.Team || 'Unknown Team';
  
  // Basic stats
  return {
    player_name: playerName,
    team_name: teamName,
    opp: row.Opponent || '',
    round: round,
    year: CURRENT_YEAR,
    match_date: row.Date ? new Date(row.Date) : new Date(),
    
    // Game stats - convert to numbers where needed
    kicks: parseInt(row.Kicks) || 0,
    handballs: parseInt(row.Handballs) || 0,
    disposals: parseInt(row.Disposals) || 0, // Sometimes provided directly
    marks: parseInt(row.Marks) || 0,
    tackles: parseInt(row.Tackles) || 0,
    hitouts: parseInt(row.Hitouts) || 0,
    goals: parseInt(row.Goals) || 0,
    behinds: parseInt(row.Behinds) || 0,
    
    // Extended stats (if available)
    centreBounceAttendances: parseInt(row.CBA) || parseInt(row['Centre Bounce Attendances']) || 0,
    kickIns: parseInt(row['Kick Ins']) || 0,
    kickInsPlayon: parseInt(row['Kick Ins Play On']) || 0,
    timeOnGroundPercentage: parseFloat(row.TOG) || parseFloat(row['Time on Ground %']) || 0,
    
    // Fantasy scores
    dreamTeamPoints: parseInt(row.DT) || parseInt(row.Fantasy) || 0,
    SC: parseInt(row.SC) || parseInt(row.SuperCoach) || 0,
    
    // Additional fields from CSV if available
    contested_possessions: parseInt(row.CP) || parseInt(row['Contested Possessions']) || 0,
    uncontested_possessions: parseInt(row.UP) || parseInt(row['Uncontested Possessions']) || 0,
    inside_50s: parseInt(row.I50) || parseInt(row['Inside 50s']) || 0,
    clearances: parseInt(row.CL) || parseInt(row.Clearances) || 0,
    
    // Add any match identification
    match_number: parseInt(row.MatchID) || parseInt(row['Match Number']) || 0,
    
    // Add timestamp for when record was created
    created_at: new Date()
  };
}

import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const round = parseInt(searchParams.get('round'));
        
        if (!round) {
            return Response.json({ error: 'Round parameter is required' }, { status: 400 });
        }

        console.log(`Attempting to update stats for round ${round}`);
        
        // Fetch stats from DFS Australia
        const statsData = await fetchDFSAustraliaStats();
        
        if (!statsData || !Array.isArray(statsData)) {
            return Response.json({ 
                error: 'Failed to fetch stats data or received invalid response' 
            }, { status: 500 });
        }
        
        // Filter for the requested round only
        const roundStats = statsData.filter(record => 
            parseInt(record.round, 10) === round
        );
        
        console.log(`Found ${roundStats.length} player stats for round ${round}`);
        
        if (roundStats.length === 0) {
            return Response.json({ 
                message: `No stats found for round ${round}` 
            }, { status: 404 });
        }
        
        // Process and update the database
        const result = await updateDatabase(roundStats, round);
        
        return Response.json({
            success: true,
            message: `Successfully updated stats for round ${round}`,
            stats: {
                roundProcessed: round,
                recordsProcessed: roundStats.length,
                recordsInserted: result.insertedCount
            }
        });

    } catch (error) {
        console.error('API Error:', error);
        return Response.json({ 
            error: 'Failed to update round stats', 
            details: error.message 
        }, { status: 500 });
    }
}

/**
 * Fetch stats data from DFS Australia
 */
async function fetchDFSAustraliaStats() {
    // DFS Australia API endpoint
    const DFS_STATS_URL = 'https://dfsaustralia.com/wp-admin/admin-ajax.php';
    
    // Add a User-Agent header to mimic a browser
    const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
    
    try {
        console.log('Downloading AFL stats from DFS Australia...');
        
        // Prepare form data
        const formData = new URLSearchParams();
        formData.append('action', 'afl_player_stats_download_call_mysql');
        
        // Make POST request to fetch the stats data
        const response = await fetch(DFS_STATS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT,
                'Origin': 'https://dfsaustralia.com',
                'Referer': 'https://dfsaustralia.com/afl-stats-download/'
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch stats: ${response.status} ${response.statusText}`);
        }
        
        const responseData = await response.json();
        
        // Handle different response formats
        let playerData;
        
        if (Array.isArray(responseData.data)) {
            // Expected format with data inside a data property
            playerData = responseData.data;
        } else if (responseData.data && typeof responseData.data === 'string') {
            // Sometimes data might be a JSON string that needs parsing
            try {
                playerData = JSON.parse(responseData.data);
            } catch (e) {
                throw new Error('Failed to parse player data string');
            }
        } else if (Array.isArray(responseData)) {
            // Direct array in response
            playerData = responseData;
        } else {
            throw new Error('Failed to extract player data: unknown format');
        }
        
        return playerData;
    } catch (error) {
        console.error('Error downloading AFL stats:', error);
        throw error;
    }
}

/**
 * Process stats data and update MongoDB
 */
async function updateDatabase(statsData, round) {
    try {
        const { db } = await connectToDatabase();
        const collection = db.collection(`${CURRENT_YEAR}_game_results`);
        
        // Process the data to match our schema
        const processedData = statsData.map(record => {
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
                round: round, // Use the specified round
                year: CURRENT_YEAR,
                match_date: new Date().toISOString().split('T')[0],
                
                // Stats from DFS Australia format
                kicks: parseInt(record.kicks, 10) || 0,
                handballs: parseInt(record.handballs, 10) || 0,
                disposals: (parseInt(record.kicks, 10) || 0) + (parseInt(record.handballs, 10) || 0),
                marks: parseInt(record.marks, 10) || 0,
                tackles: parseInt(record.tackles, 10) || 0,
                hitouts: parseInt(record.hitouts, 10) || 0,
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
                match_number: 100 + round, // Generate a match number based on the round
                startingPosition: record.namedPosition || '',
                created_at: new Date()
            };
        }).filter(record => record !== null); // Remove any invalid records
        
        // First, remove any existing data for this round
        await collection.deleteMany({
            round: round,
            year: CURRENT_YEAR
        });
        
        console.log(`Deleted existing data for round ${round}`);
        
        // Insert the processed data
        const result = await collection.insertMany(processedData);
        
        console.log(`Inserted ${result.insertedCount} records for round ${round}`);
        
        return {
            insertedCount: result.insertedCount
        };
    } catch (error) {
        console.error('Database update error:', error);
        throw error;
    }
}
// src/app/api/admin/recalculate-all/route.js

import { connectToDatabase } from '@/app/lib/mongodb';
import { CURRENT_YEAR, USER_NAMES } from '@/app/lib/constants';
import { POSITIONS } from '@/app/lib/scoring_rules';
import { getFixturesForRound } from '@/app/lib/fixture_constants';

export async function GET() {
  let results = {
    roundsProcessed: 0,
    laddersCalculated: 0,
    errors: [],
    startTime: new Date(),
    roundDetails: [],
    success: false
  };

  try {
    console.log('🚀 Starting data recalculation...');
    
    const { db } = await connectToDatabase();
    
    // Clear existing stored data
    console.log('Clearing old data...');
    await db.collection(`${CURRENT_YEAR}_round_results`).deleteMany({});
    await db.collection(`${CURRENT_YEAR}_ladder`).deleteMany({});
    
    // Process each round
    for (let round = 1; round <= 21; round++) {
      console.log(`Processing round ${round}...`);
      
      try {
        // Calculate scores for this round
        const roundResults = await calculateRoundScores(db, round);
        const totalScore = Object.values(roundResults).reduce((sum, score) => sum + score, 0);
        
        if (totalScore > 0) {
          // Store round results
          await db.collection(`${CURRENT_YEAR}_round_results`).insertOne({
            round: round,
            results: roundResults,
            lastUpdated: new Date(),
            source: 'recalculation',
            totalScore: totalScore
          });
          
          results.roundsProcessed++;
          results.roundDetails.push({
            round: round,
            totalScore: totalScore,
            highestScore: Math.max(...Object.values(roundResults))
          });
          
          console.log(`Round ${round}: ${totalScore} total points`);
        } else {
          results.roundDetails.push({
            round: round,
            totalScore: 0,
            skipped: true
          });
        }
        
      } catch (error) {
        console.error(`Error in round ${round}:`, error);
        results.errors.push(`Round ${round}: ${error.message}`);
      }
    }
    
    // Calculate ladders for each round
    for (let round = 1; round <= 21; round++) {
      try {
        const ladder = await calculateLadder(db, round);
        if (ladder.length > 0) {
          await db.collection(`${CURRENT_YEAR}_ladder`).insertOne({
            round: round,
            standings: ladder,
            lastUpdated: new Date(),
            calculatedFrom: 'recalculation'
          });
          results.laddersCalculated++;
        }
      } catch (error) {
        results.errors.push(`Ladder ${round}: ${error.message}`);
      }
    }
    
    results.endTime = new Date();
    results.duration = Math.round((results.endTime - results.startTime) / 1000);
    results.success = true;
    
    console.log('✅ Recalculation complete!');
    
  } catch (error) {
    console.error('Fatal error:', error);
    results.errors.push(`Fatal: ${error.message}`);
    results.endTime = new Date();
    results.duration = Math.round((results.endTime - results.startTime) / 1000);
  }
  
  // Return HTML response
  return new Response(generateHTML(results), {
    headers: { 'Content-Type': 'text/html' }
  });
}

async function calculateRoundScores(db, round) {
  const roundResults = {};
  
  for (const userId of Object.keys(USER_NAMES)) {
    try {
      roundResults[userId] = await calculateUserScore(db, round, userId);
    } catch (error) {
      console.error(`Error calculating score for user ${userId}:`, error);
      roundResults[userId] = 0;
    }
  }
  
  return roundResults;
}

async function calculateUserScore(db, round, userId) {
  try {
    // Get team selection
    const teamSelection = await db.collection(`${CURRENT_YEAR}_team_selection`)
      .find({ 
        Round: round,
        User: parseInt(userId),
        Active: 1 
      })
      .toArray();

    if (!teamSelection.length) {
      return 0;
    }

    // Get player stats
    const playerStats = await db.collection(`${CURRENT_YEAR}_game_results`)
      .find({ round: round })
      .toArray();

    let totalScore = 0;

    // Calculate score for each selected player
    for (const selection of teamSelection) {
      const playerStat = playerStats.find(stat => 
        stat.player_name === selection.Player_Name
      );

      if (playerStat) {
        const positionType = selection.Position.toUpperCase().replace(/\s+/g, '_');
        
        // Handle bench players with backup positions
        let scoringPosition = positionType;
        if (positionType === 'BENCH' && selection.Backup_Position) {
          scoringPosition = selection.Backup_Position.toUpperCase().replace(/\s+/g, '_');
        }
        
        const scoring = POSITIONS[scoringPosition]?.calculation(playerStat);
        if (scoring && scoring.total) {
          totalScore += scoring.total;
        }
      }
    }

    // Add dead cert score from tips
    const deadCertScore = await calculateDeadCertScore(db, round, userId);
    totalScore += deadCertScore;

    return totalScore;
    
  } catch (error) {
    console.error(`Error calculating user ${userId} score:`, error);
    return 0;
  }
}

async function calculateDeadCertScore(db, round, userId) {
  try {
    // Get tips for this round
    const tips = await db.collection(`${CURRENT_YEAR}_tips`)
      .find({ 
        Round: round,
        User: parseInt(userId),
        Active: 1,
        DeadCert: true
      }).toArray();

    if (!tips.length) {
      return 0;
    }

    // For now, return 0 - you can implement full tip scoring later
    // This would require fixture results which might not be available
    return 0;
    
  } catch (error) {
    return 0;
  }
}

async function calculateLadder(db, round) {
  try {
    // Initialize ladder
    const ladder = Object.entries(USER_NAMES).map(([userId, userName]) => ({
      userId,
      userName,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      percentage: '0.00',
      points: 0
    }));

    // Get all round results up to this round
    const allRoundResults = await db.collection(`${CURRENT_YEAR}_round_results`)
      .find({ round: { $lte: round } })
      .sort({ round: 1 })
      .toArray();

    // Process each round
    for (const roundData of allRoundResults) {
      const fixtures = getFixturesForRound(roundData.round);
      
      for (const fixture of fixtures) {
        const homeUserId = String(fixture.home);
        const awayUserId = String(fixture.away);
        
        if (!roundData.results[homeUserId] || !roundData.results[awayUserId]) {
          continue;
        }
        
        const homeScore = roundData.results[homeUserId];
        const awayScore = roundData.results[awayUserId];
        
        const homeLadder = ladder.find(entry => entry.userId === homeUserId);
        const awayLadder = ladder.find(entry => entry.userId === awayUserId);
        
        if (homeLadder && awayLadder) {
          // Update games played
          homeLadder.played++;
          awayLadder.played++;
          
          // Update points for/against
          homeLadder.pointsFor += homeScore;
          homeLadder.pointsAgainst += awayScore;
          awayLadder.pointsFor += awayScore;
          awayLadder.pointsAgainst += homeScore;
          
          // Update wins/losses/draws and ladder points
          if (homeScore > awayScore) {
            homeLadder.wins++;
            homeLadder.points += 4;
            awayLadder.losses++;
          } else if (awayScore > homeScore) {
            awayLadder.wins++;
            awayLadder.points += 4;
            homeLadder.losses++;
          } else {
            homeLadder.draws++;
            homeLadder.points += 2;
            awayLadder.draws++;
            awayLadder.points += 2;
          }
        }
      }
    }

    // Calculate percentages
    ladder.forEach(team => {
      if (team.pointsAgainst === 0) {
        team.percentage = team.pointsFor > 0 ? (team.pointsFor * 100).toFixed(2) : '0.00';
      } else {
        team.percentage = ((team.pointsFor / team.pointsAgainst) * 100).toFixed(2);
      }
    });

    // Sort by points, then percentage
    return ladder.sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      return parseFloat(b.percentage) - parseFloat(a.percentage);
    });
    
  } catch (error) {
    console.error(`Error calculating ladder for round ${round}:`, error);
    return [];
  }
}

function generateHTML(results) {
  return `<!DOCTYPE html>
<html>
<head>
    <title>Data Recalculation Results</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            max-width: 900px; 
            margin: 20px auto; 
            padding: 20px;
            line-height: 1.6;
        }
        .success { color: #16a34a; font-weight: bold; }
        .error { color: #dc2626; }
        .warning { color: #d97706; }
        .info { 
            background: #f8fafc; 
            padding: 20px; 
            border-radius: 8px; 
            margin: 15px 0;
            border-left: 4px solid #3b82f6;
        }
        .round-detail { 
            background: #f1f5f9; 
            padding: 10px 15px; 
            margin: 5px 0; 
            border-radius: 6px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .stat-box {
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: #1e40af;
        }
        .stat-label {
            color: #64748b;
            font-size: 0.9em;
        }
        pre { 
            background: #1e293b; 
            color: #f1f5f9; 
            padding: 15px; 
            border-radius: 8px; 
            overflow-x: auto;
            font-size: 0.9em;
        }
        h1 { color: #1e40af; }
        h2 { color: #334155; margin-top: 30px; }
    </style>
</head>
<body>
    <h1>🚀 Data Recalculation Results</h1>
    
    <div class="stats">
        <div class="stat-box">
            <div class="stat-number">${results.success ? '✅' : '❌'}</div>
            <div class="stat-label">Status</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${results.duration}s</div>
            <div class="stat-label">Duration</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${results.roundsProcessed}</div>
            <div class="stat-label">Rounds Processed</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${results.laddersCalculated}</div>
            <div class="stat-label">Ladders Calculated</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${results.errors.length}</div>
            <div class="stat-label">Errors</div>
        </div>
    </div>
    
    <h2>📊 Round Details</h2>
    <div>
        ${results.roundDetails.map(detail => `
            <div class="round-detail">
                <span><strong>Round ${detail.round}:</strong></span>
                <span>
                    ${detail.skipped ? 
                        '<span class="warning">⚠️ No data</span>' : 
                        `<span class="success">✅ ${detail.totalScore} pts (High: ${detail.highestScore})</span>`
                    }
                </span>
            </div>
        `).join('')}
    </div>
    
    ${results.errors.length > 0 ? `
        <h2>⚠️ Errors</h2>
        <pre>${results.errors.join('\n')}</pre>
    ` : ''}
    
    <div class="info">
        <h3>✅ What was completed:</h3>
        <ul>
            <li><strong>Team Scores:</strong> Recalculated using position-based scoring rules</li>
            <li><strong>Bench Players:</strong> Scored according to their backup positions</li>
            <li><strong>Ladder Standings:</strong> Win/loss records and ladder points</li>
            <li><strong>Percentages:</strong> Points for/against ratios</li>
        </ul>
        
        <h3>🔄 Next Steps:</h3>
        <p>Your ladder page will now show scores consistent with your results page. The data uses the same scoring system including bench substitutions and position-based calculations.</p>
    </div>
    
    <p style="text-align: center; margin-top: 40px; color: #64748b;">
        <em>Recalculation completed at ${results.endTime?.toLocaleString()}</em>
    </p>
</body>
</html>`;
}
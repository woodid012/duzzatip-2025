// src/app/api/check-fixtures/route.js
import { promises as fs } from 'fs';
import { join } from 'path';
import { CURRENT_YEAR } from '@/app/lib/constants';

// Map player team abbreviations to AFL fixture team names
const TEAM_NAME_MAPPING = {
  // 3-letter abbreviation -> AFL fixture team name
  'ADE': 'Adelaide',
  'BRL': 'Brisbane Lions',
  'BRI': 'Brisbane Lions',
  'CAR': 'Carlton',
  'COL': 'Collingwood',
  'ESS': 'Essendon',
  'FRE': 'Fremantle',
  'GEE': 'Geelong',
  'GCS': 'Gold Coast',
  'GWS': 'GWS Giants',
  'HAW': 'Hawthorn',
  'MEL': 'Melbourne',
  'NTH': 'North Melbourne',
  'NOR': 'North Melbourne',
  'PTA': 'Port Adelaide',
  'RIC': 'Richmond',
  'STK': 'St Kilda',
  'SYD': 'Sydney',
  'WCE': 'West Coast Eagles',
  'WBD': 'Western Bulldogs',
  'WES': 'Western Bulldogs',
  // Handle potential fixture team name formats
  'Adelaide': 'Adelaide',
  'Brisbane Lions': 'Brisbane Lions',
  'Brisbane': 'Brisbane Lions',
  'Carlton': 'Carlton',
  'Collingwood': 'Collingwood',
  'Essendon': 'Essendon',
  'Fremantle': 'Fremantle',
  'Geelong': 'Geelong',
  'Gold Coast': 'Gold Coast',
  'GWS Giants': 'GWS Giants',
  'Hawthorn': 'Hawthorn',
  'Melbourne': 'Melbourne',
  'North Melbourne': 'North Melbourne',
  'Port Adelaide': 'Port Adelaide',
  'Richmond': 'Richmond',
  'St Kilda': 'St Kilda',
  'Sydney': 'Sydney',
  'West Coast Eagles': 'West Coast Eagles',
  'Western Bulldogs': 'Western Bulldogs'
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const round = parseInt(searchParams.get('round'));
    const teams = searchParams.get('teams'); // Comma-separated list of team names

    if (!round || !teams) {
      return Response.json({ error: 'Round and teams parameters are required' }, { status: 400 });
    }

    // Load fixtures from local JSON file
    const fixturesPath = join(process.cwd(), 'public', `afl-${CURRENT_YEAR}.json`);
    
    let fixtures;
    try {
      const fixturesData = await fs.readFile(fixturesPath, 'utf8');
      fixtures = JSON.parse(fixturesData);
    } catch (fileError) {
      console.warn('Static fixtures file not found, fetching from API');
      
      // Fallback to API if file doesn't exist
      const response = await fetch(`https://fixturedownload.com/feed/json/afl-${CURRENT_YEAR}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch fixtures: ${response.status}`);
      }
      fixtures = await response.json();
    }

    // Get fixtures for the specific round
    const roundFixtures = fixtures.filter(f => f.RoundNumber.toString() === round.toString());
    
    // Get all teams playing in this round (using fixture team names)
    const teamsPlaying = new Set();
    roundFixtures.forEach(fixture => {
      teamsPlaying.add(fixture.HomeTeam);
      teamsPlaying.add(fixture.AwayTeam);
    });

    // Check which requested teams have fixtures
    const teamList = teams.split(',').map(team => team.trim());
    const teamFixtureStatus = {};
    
    teamList.forEach(playerTeamName => {
      // Map the player team name to the fixture team name
      const fixtureTeamName = TEAM_NAME_MAPPING[playerTeamName] || playerTeamName;
      
      // Check if this team is playing in this round
      const hasFixture = teamsPlaying.has(fixtureTeamName);
      
      teamFixtureStatus[playerTeamName] = {
        hasFixture,
        fixtureTeamName,
        fixture: hasFixture ? roundFixtures.find(f => 
          f.HomeTeam === fixtureTeamName || f.AwayTeam === fixtureTeamName
        ) : null
      };
    });

    return Response.json({
      round,
      teamFixtureStatus,
      roundFixtures,
      teamsPlayingThisRound: Array.from(teamsPlaying)
    });

  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: 'Failed to check fixtures' }, { status: 500 });
  }
}
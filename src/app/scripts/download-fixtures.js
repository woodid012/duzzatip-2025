// scripts/download-fixtures.js
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';

// Get current year or use custom year for development
const CURRENT_YEAR = new Date().getFullYear();

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function downloadFixtures() {
  try {
    console.log(`Fetching AFL fixtures for ${CURRENT_YEAR}...`);
    
    // Navigate up two directories from the scripts folder to reach the project root
    // From: /src/app/scripts/ to: / (project root)
    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    const publicDir = path.join(projectRoot, 'public');
    
    // Ensure the directory exists
    await fs.mkdir(publicDir, { recursive: true });
    
    // Fetch fixtures from API
    const response = await fetch(`https://fixturedownload.com/feed/json/afl-${CURRENT_YEAR}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch fixtures: ${response.status} ${response.statusText}`);
    }
    
    const fixtures = await response.json();
    
    // Save fixtures to public directory
    const fixturesPath = path.join(publicDir, `afl-${CURRENT_YEAR}.json`);
    await fs.writeFile(fixturesPath, JSON.stringify(fixtures, null, 2));
    
    console.log(`Fixtures saved to ${fixturesPath}`);
    return fixtures;
  } catch (error) {
    console.error('Failed to download fixtures:', error);
    throw error;
  }
}

// Run the function
downloadFixtures().catch(console.error);
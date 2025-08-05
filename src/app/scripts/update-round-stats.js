


const BASE_URL = 'http://localhost:3000'; // Adjust if your app runs on a different port or domain

async function updateRoundStats(startRound = 1) {
  try {
    console.log(`Attempting to update round stats starting from round ${startRound}...`);
    const response = await fetch(`${BASE_URL}/api/update-round-stats?startRound=${startRound}`);
    const data = await response.json();

    if (response.ok) {
      console.log('Update successful:', data.message);
      if (data.updates) {
        data.updates.forEach(update => {
          console.log(`  Round ${update.round}: ${update.status} - ${update.message}`);
        });
      }
    } else {
      console.error('Update failed:', data.error || 'Unknown error');
      if (data.details) {
        console.error('Details:', data.details);
      }
    }
  } catch (error) {
    console.error('Error fetching update:', error);
  }
}

// Get startRound from command line arguments
const args = process.argv.slice(2);
const startRoundArg = args.find(arg => arg.startsWith('--startRound='));
const startRound = startRoundArg ? parseInt(startRoundArg.split('=')[1], 10) : 1;

if (isNaN(startRound)) {
  console.error('Invalid --startRound argument. Please provide a number.');
  process.exit(1);
}

updateRoundStats(startRound);

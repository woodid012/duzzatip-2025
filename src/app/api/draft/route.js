import { connectToDatabase } from '../../lib/mongodb';
import { CURRENT_YEAR } from '@/app/lib/constants';
import { getDraftPickOrderForArray, TOTAL_PICKS, DRAFT_ORDER, ROUNDS_PER_DRAFT, USERS_PER_DRAFT, loadDraftOrderFromDB } from '@/app/lib/draft_constants';

const COLLECTION_NAME = `${CURRENT_YEAR}_draft_picks`;

// Resolve draft order: load from previous year's final standings, fall back to hardcoded
async function resolveDraftOrder(db) {
  const previousYear = CURRENT_YEAR - 1;
  const dbOrder = await loadDraftOrderFromDB(db, previousYear);
  return dbOrder || DRAFT_ORDER;
}

// GET — Returns full draft state
export async function GET() {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection(COLLECTION_NAME);

    const draftOrder = await resolveDraftOrder(db);
    const picks = await collection
      .find({ Active: 1 })
      .sort({ pick_number: 1 })
      .toArray();

    const pickOrder = getDraftPickOrderForArray(draftOrder);
    const nextPickNumber = picks.length + 1;

    let status = 'not_started';
    if (picks.length >= TOTAL_PICKS) {
      status = 'completed';
    } else if (picks.length > 0) {
      status = 'in_progress';
    }

    const nextPick = nextPickNumber <= TOTAL_PICKS ? pickOrder[nextPickNumber - 1] : null;

    return Response.json({
      picks: picks.map(p => ({
        pickNumber: p.pick_number,
        round: p.round,
        userId: p.user_id,
        playerName: p.player_name,
        teamName: p.team_name,
        timestamp: p.timestamp,
      })),
      pickOrder,
      draftOrder,
      nextPickNumber,
      nextPick,
      status,
      totalPicks: TOTAL_PICKS,
      roundsPerDraft: ROUNDS_PER_DRAFT,
      usersPerDraft: USERS_PER_DRAFT,
    });
  } catch (error) {
    console.error('Draft GET Error:', error);
    return Response.json({ error: 'Failed to load draft state' }, { status: 500 });
  }
}

// POST — Submit a pick
export async function POST(request) {
  try {
    const { userId, playerName, teamName } = await request.json();

    if (!userId || !playerName || !teamName) {
      return Response.json({ error: 'Missing required fields: userId, playerName, teamName' }, { status: 400 });
    }

    const { db } = await connectToDatabase();
    const collection = db.collection(COLLECTION_NAME);

    const draftOrder = await resolveDraftOrder(db);

    // Get current picks
    const existingPicks = await collection
      .find({ Active: 1 })
      .sort({ pick_number: 1 })
      .toArray();

    const nextPickNumber = existingPicks.length + 1;

    // Check draft is not completed
    if (nextPickNumber > TOTAL_PICKS) {
      return Response.json({ error: 'Draft is already completed' }, { status: 400 });
    }

    // Validate it's this user's turn
    const pickOrder = getDraftPickOrderForArray(draftOrder);
    const expectedPick = pickOrder[nextPickNumber - 1];
    if (expectedPick.userId !== parseInt(userId)) {
      return Response.json({
        error: `It is not user ${userId}'s turn. Expected user ${expectedPick.userId} (pick #${nextPickNumber})`,
      }, { status: 400 });
    }

    // Check player not already picked
    const alreadyPicked = existingPicks.find(
      p => p.player_name.toLowerCase() === playerName.toLowerCase()
    );
    if (alreadyPicked) {
      return Response.json({
        error: `${playerName} was already picked (pick #${alreadyPicked.pick_number})`,
      }, { status: 400 });
    }

    // Insert the pick
    await collection.insertOne({
      pick_number: nextPickNumber,
      round: expectedPick.round,
      user_id: parseInt(userId),
      player_name: playerName,
      team_name: teamName,
      timestamp: new Date(),
      Active: 1,
    });

    // If this was the final pick, auto-populate squads
    if (nextPickNumber === TOTAL_PICKS) {
      await populateSquadsFromDraft(db);
    }

    // Return updated state
    const updatedPicks = await collection
      .find({ Active: 1 })
      .sort({ pick_number: 1 })
      .toArray();

    const newNextPickNumber = updatedPicks.length + 1;
    const newNextPick = newNextPickNumber <= TOTAL_PICKS ? pickOrder[newNextPickNumber - 1] : null;

    return Response.json({
      success: true,
      picks: updatedPicks.map(p => ({
        pickNumber: p.pick_number,
        round: p.round,
        userId: p.user_id,
        playerName: p.player_name,
        teamName: p.team_name,
        timestamp: p.timestamp,
      })),
      pickOrder,
      draftOrder,
      nextPickNumber: newNextPickNumber,
      nextPick: newNextPick,
      status: newNextPickNumber > TOTAL_PICKS ? 'completed' : 'in_progress',
      totalPicks: TOTAL_PICKS,
      roundsPerDraft: ROUNDS_PER_DRAFT,
      usersPerDraft: USERS_PER_DRAFT,
    });
  } catch (error) {
    console.error('Draft POST Error:', error);
    return Response.json({ error: 'Failed to submit pick' }, { status: 500 });
  }
}

// PATCH — Admin actions (delete pick, edit pick, reset draft)
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { action } = body;

    const { db } = await connectToDatabase();
    const collection = db.collection(COLLECTION_NAME);

    switch (action) {
      case 'delete': {
        const { pickNumber } = body;
        if (!pickNumber) {
          return Response.json({ error: 'pickNumber is required' }, { status: 400 });
        }

        // Delete this pick and all subsequent picks (since they may have been influenced)
        await collection.updateMany(
          { pick_number: { $gte: parseInt(pickNumber) }, Active: 1 },
          { $set: { Active: 0 } }
        );
        break;
      }

      case 'edit': {
        const { pickNumber, playerName, teamName } = body;
        if (!pickNumber || !playerName || !teamName) {
          return Response.json({ error: 'pickNumber, playerName, and teamName are required' }, { status: 400 });
        }

        // Check the new player isn't already picked by someone else
        const conflict = await collection.findOne({
          player_name: { $regex: new RegExp(`^${playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          pick_number: { $ne: parseInt(pickNumber) },
          Active: 1,
        });
        if (conflict) {
          return Response.json({
            error: `${playerName} is already picked (pick #${conflict.pick_number})`,
          }, { status: 400 });
        }

        await collection.updateOne(
          { pick_number: parseInt(pickNumber), Active: 1 },
          { $set: { player_name: playerName, team_name: teamName, timestamp: new Date() } }
        );
        break;
      }

      case 'reset': {
        // Mark all picks as inactive
        await collection.updateMany(
          { Active: 1 },
          { $set: { Active: 0 } }
        );
        break;
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Return updated state
    const draftOrder = await resolveDraftOrder(db);
    const updatedPicks = await collection
      .find({ Active: 1 })
      .sort({ pick_number: 1 })
      .toArray();

    const pickOrder = getDraftPickOrderForArray(draftOrder);
    const nextPickNumber = updatedPicks.length + 1;
    const nextPick = nextPickNumber <= TOTAL_PICKS ? pickOrder[nextPickNumber - 1] : null;

    let status = 'not_started';
    if (updatedPicks.length >= TOTAL_PICKS) {
      status = 'completed';
    } else if (updatedPicks.length > 0) {
      status = 'in_progress';
    }

    return Response.json({
      success: true,
      picks: updatedPicks.map(p => ({
        pickNumber: p.pick_number,
        round: p.round,
        userId: p.user_id,
        playerName: p.player_name,
        teamName: p.team_name,
        timestamp: p.timestamp,
      })),
      pickOrder,
      draftOrder,
      nextPickNumber,
      nextPick,
      status,
      totalPicks: TOTAL_PICKS,
      roundsPerDraft: ROUNDS_PER_DRAFT,
      usersPerDraft: USERS_PER_DRAFT,
    });
  } catch (error) {
    console.error('Draft PATCH Error:', error);
    return Response.json({ error: 'Failed to perform admin action' }, { status: 500 });
  }
}

// Auto-populate squads when draft completes
async function populateSquadsFromDraft(db) {
  try {
    const draftPicks = await db.collection(COLLECTION_NAME)
      .find({ Active: 1 })
      .sort({ pick_number: 1 })
      .toArray();

    const squadsCollection = db.collection(`${CURRENT_YEAR}_squads`);

    const bulkOps = [];
    for (const pick of draftPicks) {
      bulkOps.push({
        updateOne: {
          filter: {
            user_id: pick.user_id,
            player_name: pick.player_name,
            team: pick.team_name,
          },
          update: {
            $set: {
              user_id: pick.user_id,
              player_name: pick.player_name,
              team: pick.team_name,
              Active: 1,
              acquisition_type: 'initial',
              acquisition_date: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await squadsCollection.bulkWrite(bulkOps, { ordered: false });
      console.log(`Draft complete: populated ${bulkOps.length} squad entries`);
    }
  } catch (error) {
    console.error('Error populating squads from draft:', error);
  }
}

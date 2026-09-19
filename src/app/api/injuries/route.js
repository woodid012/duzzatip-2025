import { connectToDatabase } from "@/app/lib/mongodb";
import { withReadCache } from "@/app/lib/apiUtils";

const YEAR = 2026;

export async function GET() {
  try {
    const { db } = await connectToDatabase();
    const doc = await db.collection("injuries").findOne({ _id: `injuries_${YEAR}` });

    if (!doc?.players || Object.keys(doc.players).length === 0) {
      return Response.json({ players: {}, updated: null });
    }

    // Injury flags are scraped periodically, not live — five minutes in the
    // browser is well inside how often they actually change.
    return withReadCache(
      Response.json({
        players: doc.players,
        updated: doc.updated?.toISOString() || null,
      }),
      300
    );
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

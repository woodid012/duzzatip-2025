import { connectToDatabase } from "@/app/lib/mongodb";

const YEAR = 2026;

export async function GET() {
  try {
    const { db } = await connectToDatabase();
    const doc = await db.collection("injuries").findOne({ _id: `injuries_${YEAR}` });

    if (!doc?.players || Object.keys(doc.players).length === 0) {
      return Response.json({ players: {}, updated: null });
    }

    return Response.json({
      players: doc.players,
      updated: doc.updated?.toISOString() || null,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { cards } from "@/db/schema";

export const runtime = "nodejs";

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const updated = await db
        .update(cards)
        .set({ isDraft: false })
        .where(eq(cards.id, id))
        .returning({ id: cards.id, isDraft: cards.isDraft, kind: cards.kind });

    if (!updated.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ card: updated[0] });
}

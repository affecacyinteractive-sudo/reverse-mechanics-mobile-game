// app/api/workshop/cards/[id]/commit/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { cards } from "@/db/schema";

export const runtime = "nodejs";

const BodySchema = z.object({ isCommitted: z.boolean() });

export async function POST(
    req: Request,
    ctx: { params: { id: string } }
) {
    const { id } = ctx.params;
    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse.call(BodySchema,json);

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const row = await db
        .select({ kind: cards.kind, isDraft: cards.isDraft })
        .from(cards)
        .where(eq(cards.id, id))
        .limit(1);

    if (!row.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (row[0].kind !== "OUTPUT") {
        return NextResponse.json({ error: "Only OUTPUT can be committed" }, { status: 400 });
    }

    if (row[0].isDraft) {
        return NextResponse.json({ error: "Draft cards cannot be committed" }, { status: 400 });
    }


    await db.update(cards).set({ isCommitted: parsed.data.isCommitted }).where(eq(cards.id, id));
    return NextResponse.json({ ok: true });
}

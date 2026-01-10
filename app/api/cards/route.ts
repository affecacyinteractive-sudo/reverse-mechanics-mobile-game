import { NextResponse } from "next/server";
import { z } from "zod";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { cards } from "@/db/schema";

export const runtime = "nodejs";

const QuerySchema = z.object({
    ids: z.string().min(1),
});

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse.call(QuerySchema,{
        ids: url.searchParams.get("ids") ?? "",
    });

    if (!parsed.success) {
        return NextResponse.json({ error: "Missing ids" }, { status: 400 });
    }

    const ids = parsed.data.ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const uuids = z.array(z.string().uuid()).safeParse(ids);
    if (!uuids.success) {
        return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
    }

    const rows = await db
        .select({
            id: cards.id,
            kind: cards.kind,
            anchor: cards.anchor,
            domain: cards.domain,
            canonId: cards.canonId,
            meta: cards.meta,
            isDraft: cards.isDraft,
        })
        .from(cards)
        .where(inArray(cards.id, uuids.data));

    return NextResponse.json({ cards: rows });
}

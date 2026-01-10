// app/api/library/route.ts
import { NextResponse } from "next/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { notInArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { cards } from "@/db/schema";

export const runtime = "nodejs";

const QuerySchema = z.object({
    sessionId: z.string().uuid().optional(),
});

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse.call(QuerySchema,{
        sessionId: url.searchParams.get("sessionId") ?? undefined,
    });

    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid query params", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const { sessionId } = parsed.data;

    const globalActionsWhere = and(
        isNull(cards.sessionId),
        eq(cards.zone, "LIBRARY"),
        eq(cards.kind, "ACTION"),
        notInArray(cards.canonId, ["GSE-SW", "GSE-ST"])
    );

    const globalPromptsWhere = and(
        isNull(cards.sessionId),
        eq(cards.zone, "LIBRARY"),
        eq(cards.kind, "PROMPT")
    );

    // Session-scoped prompts (optional)
    const sessionPromptsWhere =
        sessionId
            ? and(eq(cards.sessionId, sessionId), eq(cards.zone, "LIBRARY"), eq(cards.kind, "PROMPT"))
            : null;

    // If you still want session prompts later, keep them, but not required for now.
    const whereClause = or(globalActionsWhere, globalPromptsWhere);

    const rows = await db
        .select({
            id: cards.id,
            sessionId: cards.sessionId,
            kind: cards.kind,
            zone: cards.zone,
            domain: cards.domain,
            canonId: cards.canonId,
            schoolCode: cards.schoolCode,
            schoolName: cards.schoolName,
            anchor: cards.anchor,
            body: cards.body,
            isImmutable: cards.isImmutable,
            meta: cards.meta,
            createdAt: cards.createdAt,
        })
        .from(cards)
        .where(whereClause)
        .orderBy(
            asc(cards.domain),
            asc(cards.schoolCode),
            asc(cards.canonId),
            asc(cards.anchor)
        );

    return NextResponse.json({ cards: rows });
}

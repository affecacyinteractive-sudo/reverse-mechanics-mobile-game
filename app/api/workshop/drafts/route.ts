import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { sessions, cards } from "@/db/schema";

export const runtime = "nodejs";

async function resolveSessionId(sessionId?: string) {
    if (sessionId) return sessionId;

    const latest = await db
        .select({ id: sessions.id })
        .from(sessions)
        .orderBy(desc(sessions.createdAt))
        .limit(1);

    return latest[0]?.id ?? null;
}

const QuerySchema = z.object({
    sessionId: z.string().uuid().optional(),
});

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse.call(QuerySchema,{
        sessionId: url.searchParams.get("sessionId") ?? undefined,
    });

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const sid = await resolveSessionId(parsed.data.sessionId);
    if (!sid) return NextResponse.json({ drafts: [], sessionId: null });

    const drafts = await db
        .select({
            id: cards.id,
            sessionId: cards.sessionId,
            kind: cards.kind,
            zone: cards.zone,
            domain: cards.domain,
            canonId: cards.canonId,
            anchor: cards.anchor,
            body: cards.body,
            meta: cards.meta,
            isDraft: cards.isDraft,
            isCommitted: cards.isCommitted,
            isImmutable: cards.isImmutable,
            createdAt: cards.createdAt,
        })
        .from(cards)
        .where(
            and(
                eq(cards.sessionId, sid),
                eq(cards.zone, "WORKSHOP"),
                eq(cards.isDraft, true)
            )
        )
        .orderBy(desc(cards.createdAt));

    return NextResponse.json({ drafts, sessionId: sid });
}

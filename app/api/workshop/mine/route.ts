import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { cards, sessions } from "@/db/schema";

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

export async function GET(req: Request) {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId") ?? undefined;

    const sid = await resolveSessionId(sessionId);
    if (!sid) return NextResponse.json({ cards: [], sessionId: null });

    const rows = await db
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
                eq(cards.isDraft, false)
            )
        )
        .orderBy(desc(cards.createdAt));

    return NextResponse.json({ cards: rows, sessionId: sid });
}

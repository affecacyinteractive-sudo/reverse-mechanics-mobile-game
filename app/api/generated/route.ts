// app/api/generated/route.ts
import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { sessions, decks, cards, deckCards } from "@/db/schema";

export const runtime = "nodejs";

const QuerySchema = z.object({
    sessionId: z.string().uuid().optional(),
});

async function resolveSessionId(sessionId?: string) {
    if (sessionId) return sessionId;

    // v1: pick latest session (Demo Session exists from seeding)
    const latest = await db
        .select({ id: sessions.id })
        .from(sessions)
        .orderBy(desc(sessions.createdAt))
        .limit(1);

    return latest[0]?.id ?? null;
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
        sessionId: url.searchParams.get("sessionId") ?? undefined,
    });

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const sid = await resolveSessionId(parsed.data.sessionId);
    if (!sid) return NextResponse.json({ decks: [] });

    const deckRows = await db
        .select({
            id: decks.id,
            title: decks.title,
            createdAt: decks.createdAt,
        })
        .from(decks)
        .where(and(eq(decks.sessionId, sid), eq(decks.zone, "GENERATED")))
        .orderBy(desc(decks.createdAt));

    const deckIds = deckRows.map((d) => d.id);
    if (deckIds.length === 0) return NextResponse.json({ decks: [] });

    const linkRows = await db
        .select({
            deckId: deckCards.deckId,
            position: deckCards.position,
            card: {
                id: cards.id,
                kind: cards.kind,
                zone: cards.zone,
                domain: cards.domain,
                canonId: cards.canonId,
                anchor: cards.anchor,
                body: cards.body,
                meta: cards.meta,
            },
        })
        .from(deckCards)
        .innerJoin(cards, eq(deckCards.cardId, cards.id))
        .where(
            and(
                inArray(deckCards.deckId, deckIds),
                eq(cards.kind, "OUTPUT"),
                eq(cards.zone, "GENERATED")
            )
        )
        .orderBy(asc(deckCards.deckId), asc(deckCards.position));

    const byDeck: Record<string, any[]> = {};
    for (const row of linkRows) {
        (byDeck[row.deckId] ??= []).push(row.card);
    }

    const result = deckRows.map((d) => ({
        ...d,
        cards: byDeck[d.id] ?? [],
    }));

    return NextResponse.json({ decks: result });
}

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { cards, deckCards, decks, sessions } from "@/db/schema";

export const runtime = "nodejs";

function isPlainObject(v: unknown): v is Record<string, any> {
    return !!v && typeof v === "object" && !Array.isArray(v);
}

async function resolveSessionId(sessionId?: string) {
    if (sessionId) return sessionId;

    const latest = await db
        .select({ id: sessions.id })
        .from(sessions)
        .orderBy(desc(sessions.createdAt))
        .limit(1);

    return latest[0]?.id ?? null;
}

export async function POST(req: Request) {
    const json = await req.json().catch(() => null);
    if (!isPlainObject(json)) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const sid = await resolveSessionId(json.sessionId);
    if (!sid) return NextResponse.json({ error: "No session found" }, { status: 400 });

    const deckId = json.deckId;
    const committed = json.committed;

    if (typeof deckId !== "string") return NextResponse.json({ error: "deckId required" }, { status: 400 });
    if (typeof committed !== "boolean") return NextResponse.json({ error: "committed must be boolean" }, { status: 400 });

    const deckRow = await db
        .select({ id: decks.id, sessionId: decks.sessionId })
        .from(decks)
        .where(eq(decks.id, deckId))
        .limit(1);

    if (!deckRow.length) return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    if (deckRow[0].sessionId !== sid) return NextResponse.json({ error: "Wrong session" }, { status: 400 });

    // Only commit OUTPUT, non-draft cards that are linked to this deck.
    const linked = await db
        .select({ id: cards.id })
        .from(deckCards)
        .innerJoin(cards, eq(deckCards.cardId, cards.id))
        .where(
            and(
                eq(deckCards.deckId, deckId),
                eq(cards.sessionId, sid),
                eq(cards.kind, "OUTPUT"),
                eq(cards.isDraft, false)
            )
        );

    const ids = linked.map((r) => r.id);
    if (ids.length === 0) return NextResponse.json({ ok: true, deckId, committed, updated: 0 });

    await db.update(cards).set({ isCommitted: committed }).where(inArray(cards.id, ids));

    return NextResponse.json({ ok: true, deckId, committed, updated: ids.length });
}

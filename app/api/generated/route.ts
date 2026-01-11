// // app/api/generated/route.ts
// import { NextResponse } from "next/server";
// import { and, asc, desc, eq, inArray } from "drizzle-orm";
// import { z } from "zod";
//
// import { db } from "@/db";
// import { sessions, decks, cards, deckCards } from "@/db/schema";
//
// export const runtime = "nodejs";
//
// const QuerySchema = z.object({
//     sessionId: z.string().uuid().optional(),
// });
//
// async function resolveSessionId(sessionId?: string) {
//     if (sessionId) return sessionId;
//
//     // v1: pick latest session (Demo Session exists from seeding)
//     const latest = await db
//         .select({ id: sessions.id })
//         .from(sessions)
//         .orderBy(desc(sessions.createdAt))
//         .limit(1);
//
//     return latest[0]?.id ?? null;
// }
//
// export async function GET(req: Request) {
//     const url = new URL(req.url);
//     const parsed = QuerySchema.safeParse.call(QuerySchema,{
//         sessionId: url.searchParams.get("sessionId") ?? undefined,
//     });
//
//     if (!parsed.success) {
//         return NextResponse.json({ error: "Invalid query" }, { status: 400 });
//     }
//
//     const sid = await resolveSessionId(parsed.data.sessionId);
//     if (!sid) return NextResponse.json({ decks: [] });
//
//     const deckRows = await db
//         .select({
//             id: decks.id,
//             title: decks.title,
//             createdAt: decks.createdAt,
//         })
//         .from(decks)
//         .where(and(eq(decks.sessionId, sid), eq(decks.zone, "GENERATED")))
//         .orderBy(desc(decks.createdAt));
//
//     const deckIds = deckRows.map((d) => d.id);
//     if (deckIds.length === 0) return NextResponse.json({ decks: [] });
//
//     const linkRows = await db
//         .select({
//             deckId: deckCards.deckId,
//             position: deckCards.position,
//             card: {
//                 id: cards.id,
//                 kind: cards.kind,
//                 zone: cards.zone,
//                 domain: cards.domain,
//                 canonId: cards.canonId,
//                 anchor: cards.anchor,
//                 body: cards.body,
//                 meta: cards.meta,
//                 isCommitted: cards.isCommitted
//             },
//         })
//         .from(deckCards)
//         .innerJoin(cards, eq(deckCards.cardId, cards.id))
//         .where(
//             and(
//                 inArray(deckCards.deckId, deckIds),
//                 eq(cards.kind, "OUTPUT"),
//                 eq(cards.zone, "GENERATED")
//             )
//         )
//         .orderBy(asc(deckCards.deckId), asc(deckCards.position));
//
//     const byDeck: Record<string, any[]> = {};
//     for (const row of linkRows) {
//         (byDeck[row.deckId] ??= []).push(row.card);
//     }
//
//     const result = deckRows.map((d) => ({
//         ...d,
//         cards: byDeck[d.id] ?? [],
//     }));
//
//     return NextResponse.json({ decks: result });
// }

import { NextResponse } from "next/server";
import { and, desc, eq, inArray, asc } from "drizzle-orm";

import { db } from "@/db";
import { sessions, decks, deckCards, cards } from "@/db/schema";

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

    if (deckRows.length === 0) return NextResponse.json({ decks: [] });

    const deckIds = deckRows.map((d) => d.id);

    const cardRows = await db
        .select({
            deckId: deckCards.deckId,
            position: deckCards.position, // ⚠️ if your column differs, rename here
            id: cards.id,
            kind: cards.kind,
            zone: cards.zone,
            domain: cards.domain,
            canonId: cards.canonId,
            anchor: cards.anchor,
            body: cards.body,
            meta: cards.meta,
            isCommitted: cards.isCommitted,
            isDraft: cards.isDraft,
        })
        .from(deckCards)
        .innerJoin(cards, eq(deckCards.cardId, cards.id))
        .where(
            and(
                inArray(deckCards.deckId, deckIds),
                eq(cards.sessionId, sid),
                eq(cards.kind, "OUTPUT"),
                eq(cards.zone, "GENERATED")
            )
        )
        .orderBy(asc(deckCards.deckId), asc(deckCards.position));

    const cardsByDeck = new Map<string, any[]>();
    for (const r of cardRows) {
        const arr = cardsByDeck.get(r.deckId) ?? [];
        arr.push({
            id: r.id,
            kind: "OUTPUT",
            zone: "GENERATED",
            domain: r.domain,
            canonId: r.canonId,
            anchor: r.anchor,
            body: r.body,
            meta: r.meta,
            isCommitted: r.isCommitted,
            // generated cards are never drafts, but keeping this field here doesn't hurt
            isDraft: r.isDraft,
        });
        cardsByDeck.set(r.deckId, arr);
    }

    const result = deckRows.map((d) => ({
        id: d.id,
        title: d.title,
        createdAt: String(d.createdAt),
        cards: cardsByDeck.get(d.id) ?? [],
    }));

    return NextResponse.json({ decks: result });
}


import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { cards, sessions } from "@/db/schema";

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

    const cardId = json.cardId;
    const committed = json.committed;

    if (typeof cardId !== "string") return NextResponse.json({ error: "cardId required" }, { status: 400 });
    if (typeof committed !== "boolean") return NextResponse.json({ error: "committed must be boolean" }, { status: 400 });

    const row = await db
        .select({ id: cards.id, sessionId: cards.sessionId, kind: cards.kind, isDraft: cards.isDraft })
        .from(cards)
        .where(eq(cards.id, cardId))
        .limit(1);

    if (!row.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const c = row[0];
    if (c.sessionId !== sid) return NextResponse.json({ error: "Wrong session" }, { status: 400 });
    if (c.kind !== "OUTPUT") return NextResponse.json({ error: "Only OUTPUT cards can be committed" }, { status: 400 });
    if (c.isDraft) return NextResponse.json({ error: "Draft cards cannot be committed" }, { status: 400 });

    await db
        .update(cards)
        .set({ isCommitted: committed })
        .where(and(eq(cards.id, cardId), eq(cards.sessionId, sid)));

    return NextResponse.json({ ok: true, cardId, committed });
}

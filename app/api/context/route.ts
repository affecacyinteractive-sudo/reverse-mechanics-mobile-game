import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";

import { db } from "@/db";
import { sessions } from "@/db/schema";
import { buildContextForSession } from "@/lib/context/buildContext";

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

    const maxCardsRaw = url.searchParams.get("maxCards");
    const maxCharsRaw = url.searchParams.get("maxChars");

    const maxCards = maxCardsRaw ? Number(maxCardsRaw) : undefined;
    const maxChars = maxCharsRaw ? Number(maxCharsRaw) : undefined;

    const sid = await resolveSessionId(sessionId);
    if (!sid) return NextResponse.json({ error: "No session found" }, { status: 400 });

    const result = await buildContextForSession(sid, {
        maxCards: Number.isFinite(maxCards as any) ? maxCards : undefined,
        maxChars: Number.isFinite(maxChars as any) ? maxChars : undefined,
    });

    return NextResponse.json(result);
}

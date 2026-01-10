import { NextResponse } from "next/server";
import { and, desc, eq, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { sessions, cards } from "@/db/schema";

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

export async function GET(req: Request) {
    const url = new URL(req.url);
    const kind = (url.searchParams.get("kind") ?? "ALL").toUpperCase();
    const sessionId = url.searchParams.get("sessionId") ?? undefined;

    const sid = await resolveSessionId(sessionId);
    if (!sid) return NextResponse.json({ cards: [], sessionId: null });

    const whereClause =
        kind === "OUTPUT"
            ? and(eq(cards.sessionId, sid), eq(cards.kind, "OUTPUT"))
            : kind === "PROMPT"
                ? or(
                    and(eq(cards.sessionId, sid), eq(cards.kind, "PROMPT")),
                    and(isNull(cards.sessionId), eq(cards.kind, "PROMPT"))
                )
                : or(
                    and(eq(cards.sessionId, sid), eq(cards.kind, "OUTPUT")),
                    and(eq(cards.sessionId, sid), eq(cards.kind, "PROMPT")),
                    and(isNull(cards.sessionId), eq(cards.kind, "PROMPT"))
                );

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
            isDraft: cards.isDraft,
            isCommitted: cards.isCommitted,
            isImmutable: cards.isImmutable,
            meta: cards.meta,
            createdAt: cards.createdAt,
        })
        .from(cards)
        .where(whereClause)
        .orderBy(desc(cards.createdAt));

    return NextResponse.json({ cards: rows, sessionId: sid });
}

export async function POST(req: Request) {
    const json = await req.json().catch(() => null);
    if (!isPlainObject(json)) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const kind = json.kind;
    const anchor = json.anchor;
    const body = json.body;
    const domain = json.domain ?? "NONE";
    const meta = isPlainObject(json.meta) ? json.meta : {};

    if (kind !== "OUTPUT" && kind !== "PROMPT") {
        return NextResponse.json({ error: "kind must be OUTPUT or PROMPT" }, { status: 400 });
    }
    if (typeof anchor !== "string" || anchor.trim().length < 1 || anchor.length > 80) {
        return NextResponse.json({ error: "anchor must be 1-80 chars" }, { status: 400 });
    }
    if (typeof body !== "string" || body.trim().length < 1 || body.length > 20_000) {
        return NextResponse.json({ error: "body must be 1-20000 chars" }, { status: 400 });
    }
    if (domain !== "SOFTWARE" && domain !== "STORY" && domain !== "NONE") {
        return NextResponse.json({ error: "domain must be SOFTWARE|STORY|NONE" }, { status: 400 });
    }

    const sid = await resolveSessionId(json.sessionId);
    if (!sid) return NextResponse.json({ error: "No session found" }, { status: 400 });

    const finalMeta =
        kind === "PROMPT" ? { prompt_type: "EXECUTION", ...meta } : meta;

    const inserted = await db
        .insert(cards)
        .values({
            sessionId: sid,
            kind,
            zone: "WORKSHOP",
            domain,

            canonId: null,
            schoolCode: null,
            schoolName: null,

            anchor: anchor.trim(),
            body,

            isDraft: true,
            isCommitted: false,
            isImmutable: false,

            meta: finalMeta,
        })
        .returning({ id: cards.id });

    return NextResponse.json({ id: inserted[0].id }, { status: 201 });
}

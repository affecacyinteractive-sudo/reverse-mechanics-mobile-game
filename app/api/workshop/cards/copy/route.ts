import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { cards, sessions } from "@/db/schema";

export const runtime = "nodejs";

const BodySchema = z.object({
    sourceId: z.string().uuid(),
    sessionId: z.string().uuid().optional(),
});

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
    const parsed = BodySchema.safeParse.call(BodySchema,json);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const source = await db
        .select()
        .from(cards)
        .where(eq(cards.id, parsed.data.sourceId))
        .limit(1);

    if (!source.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const s = source[0];

    if (s.kind === "ACTION") {
        return NextResponse.json({ error: "Cannot copy ACTION cards" }, { status: 400 });
    }

    const sid = s.sessionId ?? (await resolveSessionId(parsed.data.sessionId));
    if (!sid) return NextResponse.json({ error: "No session found" }, { status: 400 });

    const inserted = await db
        .insert(cards)
        .values({
            sessionId: sid,
            kind: s.kind,
            zone: "WORKSHOP",
            domain: s.domain,

            canonId: null,
            schoolCode: null,
            schoolName: null,

            anchor: s.anchor,
            body: s.body,

            isDraft: true,
            isCommitted: false,
            isImmutable: false,

            meta: { ...(s.meta ?? {}), source_card_id: s.id },
        })
        .returning({ id: cards.id });

    return NextResponse.json({ id: inserted[0].id }, { status: 201 });
}

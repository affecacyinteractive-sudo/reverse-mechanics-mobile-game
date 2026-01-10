import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { cards } from "@/db/schema";

export const runtime = "nodejs";

function isPlainObject(v: unknown): v is Record<string, any> {
    return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const row = await db
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
        .where(eq(cards.id, id))
        .limit(1);

    if (!row.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ card: row[0] });
}

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const json = await req.json().catch(() => null);
    if (!isPlainObject(json)) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const patch: Record<string, any> = {};

    if ("anchor" in json) {
        if (typeof json.anchor !== "string" || json.anchor.trim().length < 1 || json.anchor.length > 80) {
            return NextResponse.json({ error: "anchor must be 1-80 chars" }, { status: 400 });
        }
        patch.anchor = json.anchor.trim();
    }

    if ("body" in json) {
        if (typeof json.body !== "string" || json.body.trim().length < 1 || json.body.length > 20_000) {
            return NextResponse.json({ error: "body must be 1-20000 chars" }, { status: 400 });
        }
        patch.body = json.body;
    }

    if ("domain" in json) {
        const d = json.domain;
        if (d !== "SOFTWARE" && d !== "STORY" && d !== "NONE") {
            return NextResponse.json({ error: "domain must be SOFTWARE|STORY|NONE" }, { status: 400 });
        }
        patch.domain = d;
    }

    if ("meta" in json) {
        if (!isPlainObject(json.meta)) {
            return NextResponse.json({ error: "meta must be an object" }, { status: 400 });
        }
        patch.meta = json.meta;
    }

    if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: "Empty patch" }, { status: 400 });
    }

    const updated = await db
        .update(cards)
        .set(patch)
        .where(eq(cards.id, id))
        .returning({
            id: cards.id,
            kind: cards.kind,
            zone: cards.zone,
            domain: cards.domain,
            canonId: cards.canonId,
            anchor: cards.anchor,
            body: cards.body,
            meta: cards.meta,
            isDraft: cards.isDraft,
            isCommitted: cards.isCommitted,
        });

    if (!updated.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ card: updated[0] });
}

export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    const deleted = await db
        .delete(cards)
        .where(eq(cards.id, id))
        .returning({ id: cards.id });

    if (!deleted.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
}

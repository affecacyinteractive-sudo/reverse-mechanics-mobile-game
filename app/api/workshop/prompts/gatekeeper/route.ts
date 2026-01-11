import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

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

// Deterministic hash -> 0..99 (stable "random")
function score0to99(input: string) {
    // FNV-1a-ish
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    // unsigned
    h >>>= 0;
    return h % 100;
}

function gatekeepPrompt(args: { sessionId: string; anchor: string; body: string }) {
    const anchor = args.anchor.trim();
    const body = args.body.trim();

    if (anchor.length < 1) return { accepted: false, score: 0, reason: "Anchor is empty." };
    if (body.length < 10) return { accepted: false, score: 0, reason: "Prompt is too short." };

    // deterministic pseudo randomness, stable per session + content
    const score = score0to99(`${args.sessionId}::${anchor}::${body}`);

    // accept threshold (tweak any time)
    const ACCEPT_UNDER = 85;
    if (score < ACCEPT_UNDER) return { accepted: true, score };

    return {
        accepted: false,
        score,
        reason: "Gatekeeper rejected this prompt (simulated). Try rephrasing.",
    };
}

/**
 * Body shapes:
 * - Create: { mode:"create", sessionId?, anchor, body, domain?, meta? }
 * - Revalidate existing draft: { mode:"revalidate", id, sessionId?, anchor, body, domain?, meta? }
 */
export async function POST(req: Request) {
    const json = await req.json().catch(() => null);
    if (!isPlainObject(json)) {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const mode = json.mode;
    if (mode !== "create" && mode !== "revalidate") {
        return NextResponse.json({ error: "mode must be create|revalidate" }, { status: 400 });
    }

    const sid = await resolveSessionId(json.sessionId);
    if (!sid) return NextResponse.json({ error: "No session found" }, { status: 400 });

    const anchor = typeof json.anchor === "string" ? json.anchor : "";
    const body = typeof json.body === "string" ? json.body : "";
    const domain = json.domain ?? "NONE";
    const meta = isPlainObject(json.meta) ? json.meta : {};

    if (domain !== "SOFTWARE" && domain !== "STORY" && domain !== "NONE") {
        return NextResponse.json({ error: "domain must be SOFTWARE|STORY|NONE" }, { status: 400 });
    }

    const verdict = gatekeepPrompt({ sessionId: sid, anchor, body });

    // CREATE: if rejected, create nothing
    if (mode === "create") {
        if (!verdict.accepted) {
            return NextResponse.json({
                accepted: false,
                score: verdict.score,
                reason: verdict.reason,
            });
        }

        const inserted = await db
            .insert(cards)
            .values({
                sessionId: sid,
                kind: "PROMPT",
                zone: "WORKSHOP",
                domain,

                canonId: null,
                schoolCode: null,
                schoolName: null,

                anchor: anchor.trim().slice(0, 80),
                body,

                isDraft: true,
                isCommitted: false,
                isImmutable: false,

                meta: {
                    prompt_type: "EXECUTION",
                    gatekeeper: {
                        accepted: true,
                        score: verdict.score,
                        at: new Date().toISOString(),
                    },
                    ...meta,
                },
            })
            .returning({ id: cards.id });

        return NextResponse.json({
            accepted: true,
            score: verdict.score,
            id: inserted[0].id,
        });
    }

    // REVALIDATE: if rejected, delete the draft candidate
    const id = json.id;
    if (typeof id !== "string") {
        return NextResponse.json({ error: "id required for revalidate" }, { status: 400 });
    }

    const row = await db
        .select({ id: cards.id, kind: cards.kind, zone: cards.zone, isDraft: cards.isDraft })
        .from(cards)
        .where(eq(cards.id, id))
        .limit(1);

    if (!row.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (row[0].kind !== "PROMPT" || row[0].zone !== "WORKSHOP") {
        return NextResponse.json({ error: "Only WORKSHOP PROMPT cards can be revalidated" }, { status: 400 });
    }

    // We only "revalidate" drafts. Non-draft prompts should be edited via copy-to-draft.
    if (!row[0].isDraft) {
        return NextResponse.json({ error: "Only draft prompts can be revalidated" }, { status: 400 });
    }

    if (!verdict.accepted) {
        await db.delete(cards).where(eq(cards.id, id));
        return NextResponse.json({
            accepted: false,
            deleted: true,
            score: verdict.score,
            reason: verdict.reason,
        });
    }

    await db
        .update(cards)
        .set({
            anchor: anchor.trim().slice(0, 80),
            body,
            domain,
            meta: {
                prompt_type: "EXECUTION",
                gatekeeper: {
                    accepted: true,
                    score: verdict.score,
                    at: new Date().toISOString(),
                },
                ...meta,
            },
        })
        .where(eq(cards.id, id));

    return NextResponse.json({
        accepted: true,
        deleted: false,
        score: verdict.score,
        id,
    });
}

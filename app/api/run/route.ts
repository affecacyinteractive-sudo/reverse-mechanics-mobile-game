import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { generateText } from "ai";

import { db } from "@/db";
import { sessions, cards, decks, deckCards } from "@/db/schema"; // <- adjust if different
import { buildContextForSession } from "@/lib/context/buildContext";
import { getModel } from "@/lib/ai/model";
import { GLOBAL_SOFTWARE_EXECUTOR } from "@/lib/prompts/globalSoftwareExecutor";
import { GLOBAL_STORY_EXECUTOR } from "@/lib/prompts/globalStoryExecutor";
import { parseExecutorOutput } from "@/lib/run/parseExecutorOutput";
import { normalizeExecutorChunks } from "@/lib/run/normalizeExecutorChunks";


export const runtime = "nodejs";


function rid() {
    return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function safePreview(s: unknown, n = 600) {
    if (typeof s !== "string") return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
}

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
    const requestId = rid();
    const t0 = Date.now();

    // optional: debug flag either in URL or body
    const url = new URL(req.url);
    const debugFromUrl = url.searchParams.get("debug") === "1";

    let body: any = null;
    try {
        body = await req.json().catch(() => null);
    } catch {
        // ignore
    }

    const debug = debugFromUrl || body?.debug === true;

    console.log(`[run:${requestId}] start`, {
        debug,
        hasBody: !!body,
        at: new Date().toISOString(),
    });

    try {
        // ✅ PUT YOUR EXISTING RUN LOGIC HERE
        // Replace any "const json = await req.json()" with "const json = body" (already parsed above)
        const json = body;

        if (!isPlainObject(json)) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

        const sid = await resolveSessionId(json.sessionId);
        if (!sid) return NextResponse.json({ error: "No session found" }, { status: 400 });

        const actionId = json.actionId;
        const promptId = json.promptId;
        const targetIds = Array.isArray(json.targetIds) ? json.targetIds.filter((x) => typeof x === "string") : [];

        if (typeof actionId !== "string") return NextResponse.json({ error: "actionId required" }, { status: 400 });
        if (typeof promptId !== "string") return NextResponse.json({ error: "promptId required" }, { status: 400 });

        // Load action + prompt
        const [action] = await db
            .select({
                id: cards.id,
                kind: cards.kind,
                zone: cards.zone,
                domain: cards.domain,
                canonId: cards.canonId,
                anchor: cards.anchor,
                body: cards.body,
                meta: cards.meta,
                isDraft: cards.isDraft,
            })
            .from(cards)
            .where(eq(cards.id, actionId))
            .limit(1);

        if (!action || action.kind !== "ACTION") {
            return NextResponse.json({ error: "actionId must point to an ACTION card" }, { status: 400 });
        }

        const [prompt] = await db
            .select({
                id: cards.id,
                kind: cards.kind,
                zone: cards.zone,
                domain: cards.domain,
                anchor: cards.anchor,
                body: cards.body,
                meta: cards.meta,
                isDraft: cards.isDraft,
            })
            .from(cards)
            .where(eq(cards.id, promptId))
            .limit(1);

        if (!prompt || prompt.kind !== "PROMPT") {
            return NextResponse.json({ error: "promptId must point to a PROMPT card" }, { status: 400 });
        }
        if (prompt.isDraft) {
            return NextResponse.json({ error: "Prompt must not be a Draft" }, { status: 400 });
        }

        // Load targets
        const targets =
            targetIds.length === 0
                ? []
                : await db
                    .select({
                        id: cards.id,
                        kind: cards.kind,
                        zone: cards.zone,
                        domain: cards.domain,
                        anchor: cards.anchor,
                        body: cards.body,
                        meta: cards.meta,
                        isDraft: cards.isDraft,
                    })
                    .from(cards)
                    .where(inArray(cards.id, targetIds));

        // Enforce: targets must be OUTPUT, not draft
        for (const t of targets) {
            if (t.kind !== "OUTPUT") {
                return NextResponse.json({ error: `Target ${t.id} must be an OUTPUT card` }, { status: 400 });
            }
            if (t.isDraft) {
                return NextResponse.json({ error: `Target ${t.id} must not be a Draft` }, { status: 400 });
            }
        }

        console.log(`[run:${requestId}] loaded`, { actionId, promptId, targets: targetIds.length });

        // Build evolving story context from committed OUTPUT only
        const ctx = await buildContextForSession(sid, { maxCards: 60, maxChars: 20_000 });

        console.log(`[run:${requestId}] context`, {
            usedChars: ctx.usedChars,
            chunksIncluded: ctx.chunksIncluded,
        });

        // Choose global executor
        const globalExecutor =
            action.domain === "STORY" ? GLOBAL_STORY_EXECUTOR : GLOBAL_SOFTWARE_EXECUTOR;

        // Card-specific action prompt is action.body
        const systemPrompt = `${globalExecutor}\n\nCARD-SPECIFIC ACTION PROMPT:\n${action.body}`.trim();

        const input = {
            context: ctx.context,
            action_id: action.canonId ?? action.id,
            user_intent: prompt.body,
            targets: targets.map((t) => ({
                target: { id: t.id, type: t.meta?.chunk_type === "code" ? "code" : "text", anchor: t.anchor, body: t.body },
                before: [],
                after: [],
            })),
        };

        const model = getModel();

        console.log(`[run:${requestId}] model_call`, {
            provider: process.env.RM_PROVIDER,
            model: process.env.RM_MODEL,
        });

        const startedAt = Date.now();
        const result = await generateText({
            model,
            system: systemPrompt,
            prompt: JSON.stringify(input),
        });

        console.log(`[run:${requestId}] model_return`, {
            textPreview: safePreview(result.text, 400),
        });

        const durationMs = Date.now() - startedAt;

        const parsed = parseExecutorOutput(result.text);

        console.log(`[run:${requestId}] parsed`, {
            ok: parsed.ok,
            chunks: parsed.ok ? parsed.chunks.length : 0,
            error: parsed.ok ? null : parsed.error,
        });

        const executorMode = action.domain === "STORY" ? "STORY" : "SOFTWARE";

        const rawChunks = parsed.ok
            ? parsed.chunks
            : [
                {
                    id: "t1",
                    type: "text" as const,
                    anchor: "Parse Error",
                    body: `Executor output invalid.\n\nReason: ${parsed.error}\n\nRaw:\n${result.text.slice(0, 2000)}`,
                },
            ];

        const normalized = normalizeExecutorChunks({
            chunks: rawChunks,
            opts: {
                mode: executorMode,
                maxChunks: 16,
                maxTotalChars: 14_000,
                maxTextChars: 1200,
                maxCodeChars: 3000,
            },
        });

// If the model output becomes empty after normalization, force one error chunk.
        const finalChunks =
            normalized.chunks.length > 0
                ? normalized.chunks
                : [
                    {
                        id: "t1",
                        type: "text" as const,
                        anchor: "Empty Output",
                        body: "Model output was empty after normalization.",
                    },
                ];

        // If parse fails, create a single OUTPUT error card
        // const chunks = parsed.ok
        //     ? parsed.chunks
        //     : [
        //         {
        //             id: "t1",
        //             type: "text" as const,
        //             anchor: "Parse Error",
        //             body: `Executor output invalid.\n\nReason: ${parsed.error}\n\nRaw:\n${result.text.slice(0, 2000)}`,
        //         },
        //     ];

        // Create a Generated deck + cards
        const deckTitle = `Run: ${action.anchor}`;

        const created = await db.transaction(async (tx) => {
            const [deck] = await tx
                .insert(decks)
                .values({
                    sessionId: sid,
                    zone: "GENERATED",
                    title: deckTitle,
                    meta: {
                        model: process.env.RM_MODEL ?? null,
                        provider: process.env.RM_PROVIDER ?? null,
                        durationMs,
                        usedChars: ctx.usedChars,
                        chunksIncluded: ctx.chunksIncluded,
                        actionId: action.id,
                        promptId: prompt.id,
                        targetIds: targets.map((t) => t.id),
                        parseOk: parsed.ok,
                        normalizerWarnings: normalized.warnings.length,
                    },
                })
                .returning({ id: decks.id });

            const insertedCards = await tx
                .insert(cards)
                .values(
                    finalChunks.map((c) => ({
                        sessionId: sid,
                        kind: "OUTPUT",
                        zone: "GENERATED",
                        domain: action.domain ?? "NONE",
                        canonId: null,
                        schoolCode: null,
                        schoolName: null,
                        anchor: c.anchor,
                        body: c.body,
                        isDraft: false,
                        isCommitted: false,
                        isImmutable: false,
                        meta: {
                            chunk_id: c.id,
                            chunk_type: c.type,
                            link: c.type === "code" ? (c as any).link : null,
                            normalizer: {
                                warnings: normalized.warnings.slice(0, 30), // keep it small
                            },
                        },
                    }))
                )
                .returning({ id: cards.id });

            // Link cards to deck in order
            await tx.insert(deckCards).values(
                insertedCards.map((row, position) => ({
                    deckId: deck.id,
                    cardId: row.id,
                    position,
                }))
            );

            return { deckId: deck.id, cardIds: insertedCards.map((x) => x.id) };
        });

        const totalMs = Date.now() - t0;
        console.log(`[run:${requestId}] success`, { totalMs });

        return NextResponse.json({
            ok: true,
            deckId: created.deckId,
            cardIds: created.cardIds,
            durationMs,
            contextUsedChars: ctx.usedChars,
            chunksOut: finalChunks.length,
            parseOk: parsed.ok,
        });

    } catch (err: any) {
        const totalMs = Date.now() - t0;

        console.error(`[run:${requestId}] error`, {
            totalMs,
            message: err?.message,
            name: err?.name,
            stack: err?.stack,
        });

        // Always return JSON so the client sees something useful.
        return NextResponse.json(
            {
                requestId,
                ok: false,
                error: err?.message ?? "Unknown error",
                // include stack only in debug/dev
                ...(debug
                    ? {
                        name: err?.name,
                        stack: err?.stack,
                    }
                    : {}),
            },
            { status: 500 }
        );
    }
}





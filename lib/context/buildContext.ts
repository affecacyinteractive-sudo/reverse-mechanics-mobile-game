import { and, desc, eq } from "drizzle-orm";
import crypto from "crypto";
import { db } from "@/db";
import { cards } from "@/db/schema";

export type ContextBuildOptions = {
    maxCards?: number;
    maxChars?: number;
};

function wrapIfNeeded(args: {
    body: string;
    domain: "SOFTWARE" | "STORY" | "NONE";
    meta: any;
}) {
    const raw = (args.body ?? "").trim();

    const hasStoryTag = raw.includes("<story>") && raw.includes("</story>");
    const hasSoftwareTag = raw.includes("<software>") && raw.includes("</software>");
    if (hasStoryTag || hasSoftwareTag) return raw;

    const metaTag = args.meta?.context_tag;
    const tag =
        metaTag === "story"
            ? "story"
            : metaTag === "software"
                ? "software"
                : args.domain === "STORY"
                    ? "story"
                    : args.domain === "SOFTWARE"
                        ? "software"
                        : null;

    if (!tag) return raw;
    return `<${tag}>\n${raw}\n</${tag}>`;
}

export async function buildContextForSession(sessionId: string, opts: ContextBuildOptions = {}) {
    const maxCards = Math.max(1, Math.min(opts.maxCards ?? 60, 300));
    const maxChars = Math.max(500, Math.min(opts.maxChars ?? 20_000, 200_000));

    // newest first
    const rows = await db
        .select({
            id: cards.id,
            anchor: cards.anchor,
            domain: cards.domain,
            body: cards.body,
            meta: cards.meta,
            createdAt: cards.createdAt,
        })
        .from(cards)
        .where(
            and(
                eq(cards.sessionId, sessionId),
                eq(cards.kind, "OUTPUT"),
                eq(cards.isCommitted, true),
                eq(cards.isDraft, false)
            )
        )
        .orderBy(desc(cards.createdAt))
        .limit(maxCards);

    const chosenChunks: string[] = [];
    const chosenSources: Array<{
        id: string;
        anchor: string;
        domain: "SOFTWARE" | "STORY" | "NONE";
        createdAt: string;
    }> = [];

    let used = 0;

    for (const r of rows) {
        const inner = wrapIfNeeded({ body: r.body, domain: r.domain, meta: r.meta });
        const chunk = `<chunk>\n${inner}\n</chunk>\n`;

        if (used + chunk.length > maxChars) continue; // skip chunks that don't fit
        chosenChunks.push(chunk);
        chosenSources.push({
            id: r.id,
            anchor: r.anchor,
            domain: r.domain,
            createdAt: new Date(r.createdAt as any).toISOString(),
        });
        used += chunk.length;
        if (used >= maxChars) break;
    }

    chosenChunks.reverse();
    chosenSources.reverse();

    const context = chosenChunks.join("");
    const hash = crypto.createHash("sha256").update(context).digest("hex");

    return {
        sessionId,
        maxCards,
        maxChars,
        usedChars: used,
        chunksIncluded: chosenChunks.length,
        sources: chosenSources,
        hash,
        context,
    };
}

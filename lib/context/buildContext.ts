import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cards } from "@/db/schema";

export type ContextBuildOptions = {
    maxCards?: number;   // soft cap (we may include fewer due to maxChars)
    maxChars?: number;   // hard cap on returned string length
};

function wrapIfNeeded(args: {
    body: string;
    domain: "SOFTWARE" | "STORY" | "NONE";
    meta: any;
}) {
    const raw = (args.body ?? "").trim();

    // If the body already contains story/software tags, preserve as-is.
    const hasStoryTag = raw.includes("<story>") && raw.includes("</story>");
    const hasSoftwareTag = raw.includes("<software>") && raw.includes("</software>");
    if (hasStoryTag || hasSoftwareTag) return raw;

    // Prefer explicit meta tag if present; fallback to domain.
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

export async function buildContextForSession(
    sessionId: string,
    opts: ContextBuildOptions = {}
) {
    const maxCards = Math.max(1, Math.min(opts.maxCards ?? 60, 300));
    const maxChars = Math.max(500, Math.min(opts.maxChars ?? 20_000, 200_000));

    // Pull newest first; we’ll trim to budget and then reverse to chronological.
    const rows = await db
        .select({
            id: cards.id,
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

    // Build from newest → oldest until char budget hit, then reverse for chronological.
    const chosen: string[] = [];
    let used = 0;

    for (const r of rows) {
        const inner = wrapIfNeeded({ body: r.body, domain: r.domain, meta: r.meta });
        const chunk = `<chunk>\n${inner}\n</chunk>\n`;

        if (used + chunk.length > maxChars) continue; // skip oversized chunks
        chosen.push(chunk);
        used += chunk.length;

        if (used >= maxChars) break;
    }

    chosen.reverse();

    return {
        sessionId,
        maxCards,
        maxChars,
        usedChars: used,
        chunksIncluded: chosen.length,
        context: chosen.join(""),
    };
}

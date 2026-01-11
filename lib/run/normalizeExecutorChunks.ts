type Chunk =
    | { id: string; type: "text"; anchor: string; body: string }
    | { id: string; type: "code"; anchor: string; body: string; link: string };

export type NormalizeMode = "SOFTWARE" | "STORY";

export type NormalizeOptions = {
    mode: NormalizeMode;

    // per-generation budgets
    maxChunks?: number; // cap number of chunks we accept
    maxTotalChars?: number; // cap total body chars across all chunks

    // per-chunk caps
    maxTextChars?: number;
    maxCodeChars?: number;
};

export type NormalizeResult = {
    chunks: Chunk[];
    warnings: string[];
    dropped: number;
};

function stripCodeFences(raw: string) {
    let s = raw.trim();
    if (s.startsWith("```")) {
        const firstNl = s.indexOf("\n");
        if (firstNl !== -1) s = s.slice(firstNl + 1);
        const lastFence = s.lastIndexOf("```");
        if (lastFence !== -1) s = s.slice(0, lastFence);
    }
    return s.trim();
}

function normalizeAnchor(anchor: string): { anchor: string; warnings: string[] } {
    const warnings: string[] = [];
    let a = (anchor ?? "").replace(/\s+/g, " ").trim();

    const words = a.split(" ").filter(Boolean);

    if (words.length === 0) {
        a = "Untitled Card";
        warnings.push(`anchor repaired: empty → "${a}"`);
    } else if (words.length === 1) {
        a = `${words[0]} Card`;
        warnings.push(`anchor repaired: 1 word → "${a}"`);
    } else if (words.length > 3) {
        a = words.slice(0, 3).join(" ");
        warnings.push(`anchor trimmed to 3 words → "${a}"`);
    } // 2–3 words ok

    if (a.length > 40) {
        a = a.slice(0, 40).trim();
        warnings.push(`anchor truncated to 40 chars`);
    }

    return { anchor: a, warnings };
}

function unwrapBulletsToProse(body: string) {
    // Minimal “de-listing”: remove leading bullet/number markers and join lines.
    const lines = body.split("\n");
    const cleaned = lines.map((line) =>
        line
            .replace(/^\s*[-*]\s+/, "")
            .replace(/^\s*\d+\.\s+/, "")
            .trim()
    );

    // If it looks like a list, join into a paragraph-ish string.
    return cleaned.filter((x) => x.length > 0).join(" ");
}

function truncate(s: string, n: number) {
    if (s.length <= n) return s;
    return s.slice(0, n) + "\n…(truncated)";
}

export function normalizeExecutorChunks(input: {
    chunks: Chunk[];
    opts: NormalizeOptions;
}): NormalizeResult {
    const mode = input.opts.mode;

    const maxChunks = input.opts.maxChunks ?? 16;
    const maxTotalChars = input.opts.maxTotalChars ?? 14_000;

    const maxTextChars = input.opts.maxTextChars ?? 1200;
    const maxCodeChars = input.opts.maxCodeChars ?? 3000;

    const warnings: string[] = [];
    const out: Chunk[] = [];

    // Pass 1: per-chunk repairs + story-mode code handling
    let lastTextId: string | null = null;
    const seenTextIds = new Set<string>();

    for (const original of input.chunks.slice(0, maxChunks)) {
        const { anchor, warnings: aw } = normalizeAnchor(original.anchor);
        warnings.push(...aw.map((w) => `[${original.id}] ${w}`));

        if (original.type === "text") {
            let body = stripCodeFences(original.body);

            // discourage nested chunk tags (can happen with "context reprint")
            if (body.includes("<chunk>") || body.includes("</chunk>")) {
                body = body.replaceAll("<chunk>", "").replaceAll("</chunk>", "").trim();
                warnings.push(`[${original.id}] removed nested <chunk> tags`);
            }

            // flatten list-y text
            if (/(^\s*[-*]\s+)|(^\s*\d+\.\s+)/m.test(body)) {
                body = unwrapBulletsToProse(body);
                warnings.push(`[${original.id}] unwrapped list formatting`);
            }

            if (body.length > maxTextChars) {
                body = truncate(body, maxTextChars);
                warnings.push(`[${original.id}] text body truncated`);
            }

            const chunk: Chunk = { id: original.id, type: "text", anchor, body };
            out.push(chunk);

            lastTextId = chunk.id;
            seenTextIds.add(chunk.id);
            continue;
        }

        // code chunk
        let code = stripCodeFences(original.body);

        if (code.length > maxCodeChars) {
            code = truncate(code, maxCodeChars);
            warnings.push(`[${original.id}] code body truncated`);
        }

        if (mode === "STORY") {
            // Story executor must not emit code: convert to text card (preserve content).
            const chunk: Chunk = {
                id: original.id,
                type: "text",
                anchor: anchor, // anchor already repaired
                body: `This story output included code, which is not allowed for Story runs. Content preserved below.\n\n${code}`,
            };
            out.push(chunk);
            warnings.push(`[${original.id}] code converted → text (story mode)`);
            lastTextId = chunk.id;
            seenTextIds.add(chunk.id);
            continue;
        }

        // SOFTWARE: enforce link contract
        let link = (original as any).link as string | undefined;

        if (!link || typeof link !== "string" || !link.trim()) {
            if (lastTextId) {
                link = lastTextId;
                warnings.push(`[${original.id}] missing link repaired → ${link}`);
            } else {
                // No framing text exists; convert to text rather than violate contract.
                const chunk: Chunk = {
                    id: original.id,
                    type: "text",
                    anchor: "Missing Frame",
                    body: `This code lacked a framing text chunk. Add a text chunk before it and link properly.\n\n${code}`,
                };
                out.push(chunk);
                warnings.push(`[${original.id}] missing frame: code converted → text`);
                lastTextId = chunk.id;
                seenTextIds.add(chunk.id);
                continue;
            }
        } else if (!seenTextIds.has(link)) {
            if (lastTextId) {
                warnings.push(`[${original.id}] invalid link "${link}" repaired → ${lastTextId}`);
                link = lastTextId;
            } else {
                const chunk: Chunk = {
                    id: original.id,
                    type: "text",
                    anchor: "Invalid Link",
                    body: `This code linked to a non-existent framing text chunk ("${link}"). Content preserved below.\n\n${code}`,
                };
                out.push(chunk);
                warnings.push(`[${original.id}] invalid link: code converted → text`);
                lastTextId = chunk.id;
                seenTextIds.add(chunk.id);
                continue;
            }
        }

        out.push({ id: original.id, type: "code", anchor, body: code, link });
    }

    // Pass 2: total budget (drop tail to fit maxTotalChars)
    const final: Chunk[] = [];
    let used = 0;

    for (const c of out) {
        const cost = (c.body?.length ?? 0) + (c.anchor?.length ?? 0) + 32;
        if (used + cost > maxTotalChars) break;
        final.push(c);
        used += cost;
    }

    const dropped = input.chunks.length - final.length;
    if (input.chunks.length > maxChunks) {
        warnings.push(`maxChunks enforced: kept ${maxChunks}, dropped ${input.chunks.length - maxChunks}`);
    }
    if (final.length < out.length) {
        warnings.push(`maxTotalChars enforced: truncated output to ${final.length} chunks`);
    }

    return { chunks: final, warnings, dropped: Math.max(0, dropped) };
}

// type Chunk =
//     | { id: string; type: "text"; anchor: string; body: string }
//     | { id: string; type: "code"; anchor: string; body: string; link: string };
//
// export function parseExecutorOutput(raw: string): { ok: true; chunks: Chunk[] } | { ok: false; error: string } {
//     let obj: any;
//     try {
//         obj = JSON.parse(raw);
//     } catch {
//         return { ok: false, error: "Model did not return valid JSON." };
//     }
//
//     if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
//         return { ok: false, error: "Top-level JSON must be an object." };
//     }
//     const keys = Object.keys(obj);
//     if (keys.length !== 1 || keys[0] !== "chunks") {
//         return { ok: false, error: `Top-level JSON must have exactly one key "chunks".` };
//     }
//     if (!Array.isArray(obj.chunks)) {
//         return { ok: false, error: `"chunks" must be an array.` };
//     }
//
//     const chunks: Chunk[] = [];
//     const ids = new Set<string>();
//
//     for (const c of obj.chunks) {
//         if (!c || typeof c !== "object") return { ok: false, error: "Each chunk must be an object." };
//         if (typeof c.id !== "string" || !c.id.trim()) return { ok: false, error: "Chunk id missing." };
//         if (ids.has(c.id)) return { ok: false, error: `Duplicate chunk id: ${c.id}` };
//         ids.add(c.id);
//
//         if (c.type !== "text" && c.type !== "code") return { ok: false, error: `Invalid chunk type for ${c.id}` };
//         if (typeof c.anchor !== "string" || !c.anchor.trim()) return { ok: false, error: `Missing anchor for ${c.id}` };
//         if (typeof c.body !== "string") return { ok: false, error: `Missing body for ${c.id}` };
//
//         if (c.type === "text") {
//             chunks.push({ id: c.id, type: "text", anchor: c.anchor, body: c.body });
//             continue;
//         }
//
//         if (typeof c.link !== "string" || !c.link.trim()) return { ok: false, error: `Missing link for ${c.id}` };
//         chunks.push({ id: c.id, type: "code", anchor: c.anchor, body: c.body, link: c.link });
//     }
//
//     return { ok: true, chunks };
// }

type Chunk =
    | { id: string; type: "text"; anchor: string; body: string }
    | { id: string; type: "code"; anchor: string; body: string; link: string };

function stripCodeFences(raw: string) {
    let s = raw.trim();

    // Remove leading ```json or ``` fences
    if (s.startsWith("```")) {
        // remove first line (``` or ```json)
        const firstNl = s.indexOf("\n");
        if (firstNl !== -1) s = s.slice(firstNl + 1);
        // remove trailing ```
        const lastFence = s.lastIndexOf("```");
        if (lastFence !== -1) s = s.slice(0, lastFence);
        s = s.trim();
    }

    // If model included extra preface text, try to extract the first JSON object.
    const firstBrace = s.indexOf("{");
    const lastBrace = s.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        s = s.slice(firstBrace, lastBrace + 1);
    }

    return s.trim();
}

export function parseExecutorOutput(raw: string): { ok: true; chunks: Chunk[] } | { ok: false; error: string } {
    const cleaned = stripCodeFences(raw);

    let obj: any;
    try {
        obj = JSON.parse(cleaned);
    } catch {
        return { ok: false, error: "Model did not return valid JSON." };
    }

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        return { ok: false, error: "Top-level JSON must be an object." };
    }
    const keys = Object.keys(obj);
    if (keys.length !== 1 || keys[0] !== "chunks") {
        return { ok: false, error: `Top-level JSON must have exactly one key "chunks".` };
    }
    if (!Array.isArray(obj.chunks)) {
        return { ok: false, error: `"chunks" must be an array.` };
    }

    const chunks: Chunk[] = [];
    const ids = new Set<string>();

    for (const c of obj.chunks) {
        if (!c || typeof c !== "object") return { ok: false, error: "Each chunk must be an object." };
        if (typeof c.id !== "string" || !c.id.trim()) return { ok: false, error: "Chunk id missing." };
        if (ids.has(c.id)) return { ok: false, error: `Duplicate chunk id: ${c.id}` };
        ids.add(c.id);

        if (c.type !== "text" && c.type !== "code") return { ok: false, error: `Invalid chunk type for ${c.id}` };
        if (typeof c.anchor !== "string" || !c.anchor.trim()) return { ok: false, error: `Missing anchor for ${c.id}` };
        if (typeof c.body !== "string") return { ok: false, error: `Missing body for ${c.id}` };

        if (c.type === "text") {
            chunks.push({ id: c.id, type: "text", anchor: c.anchor, body: c.body });
            continue;
        }

        if (typeof c.link !== "string" || !c.link.trim()) return { ok: false, error: `Missing link for ${c.id}` };
        chunks.push({ id: c.id, type: "code", anchor: c.anchor, body: c.body, link: c.link });
    }

    return { ok: true, chunks };
}


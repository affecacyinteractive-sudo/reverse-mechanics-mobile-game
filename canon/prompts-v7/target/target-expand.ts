// target-expand.ts
// Deterministic step: TARGET-EXPAND
// Expands the single Target sleeve into the full underlying chunks to be passed to an action.
//
// Rule: Target is a selector (proxy). For action execution, we pass the real chunks it proxies.
// This step supports two storage shapes:
//  1) sleeve.chunks[] is already present (embedded chunks)  ✅ easiest
//  2) sleeve.chunk_ids[] exists (references) → fetch via ChunkStore

import crypto from "node:crypto";
import type { Chunk, ChunkSleeve, ProjectId } from "./types-2";

export interface ChunkStore {
    getChunksByIds(args: { project_id: ProjectId; chunk_ids: string[] }): Promise<Chunk[]>;
}

export type TargetExpandResult =
    | {
    ok: true;
    seals: [];
    target_chunks: Chunk[];
}
    | {
    ok: false;
    seals: [Chunk];
    target_chunks: [];
};

function uuid() {
    return crypto.randomUUID();
}

function makeSeal(title: string, body: string): Chunk {
    return { id: `seal_${uuid()}`, kind: "TEXT", title, body };
}

function uniqById(chunks: Chunk[]): Chunk[] {
    const seen = new Set<string>();
    const out: Chunk[] = [];
    for (const c of chunks) {
        if (!c?.id) continue;
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
    }
    return out;
}

/**
 * TARGET-EXPAND:
 * - Input: validated target sleeve
 * - Output: underlying chunks to feed into the action prompt
 */
export async function targetExpand(args: {
    project_id: ProjectId;
    target_sleeve: ChunkSleeve;
    chunk_store?: ChunkStore;   // required if sleeve only stores chunk_ids
    max_chunks?: number;        // optional cap (defaults to no cap)
}): Promise<TargetExpandResult> {
    const { project_id, target_sleeve, chunk_store, max_chunks } = args;

    // Shape A: embedded chunks
    const embedded = (target_sleeve as any)?.chunks;
    if (Array.isArray(embedded) && embedded.length > 0) {
        const chunks = uniqById(embedded);
        const capped = typeof max_chunks === "number" ? chunks.slice(0, max_chunks) : chunks;

        if (!capped.length) {
            return {
                ok: false,
                target_chunks: [],
                seals: [
                    makeSeal(
                        "TARGET_UNUSABLE",
                        "Target expand failed: sleeve chunks were present but unusable. Ensure the target sleeve contains valid chunk objects with id/kind/title/body."
                    ),
                ],
            };
        }

        return { ok: true, seals: [], target_chunks: capped };
    }

    // Shape B: referenced chunk ids
    const chunk_ids = (target_sleeve as any)?.chunk_ids as string[] | undefined;
    if (Array.isArray(chunk_ids) && chunk_ids.length > 0) {
        if (!chunk_store) {
            return {
                ok: false,
                target_chunks: [],
                seals: [
                    makeSeal(
                        "TARGET_UNUSABLE",
                        "Target expand failed: sleeve contains chunk_ids but no chunk_store was provided. Provide a chunk_store to load the underlying chunks for this target."
                    ),
                ],
            };
        }

        const loaded = await chunk_store.getChunksByIds({ project_id, chunk_ids });
        const chunks = uniqById(loaded);
        const capped = typeof max_chunks === "number" ? chunks.slice(0, max_chunks) : chunks;

        if (!capped.length) {
            return {
                ok: false,
                target_chunks: [],
                seals: [
                    makeSeal(
                        "TARGET_UNUSABLE",
                        "Target expand failed: could not load any chunks for the target sleeve. Ensure the chunk_ids exist and are accessible."
                    ),
                ],
            };
        }

        return { ok: true, seals: [], target_chunks: capped };
    }

    // Neither shape available
    return {
        ok: false,
        target_chunks: [],
        seals: [
            makeSeal(
                "TARGET_UNUSABLE",
                "Target expand failed: the sleeve has neither embedded chunks nor chunk_ids to expand. Ensure the target sleeve stores its underlying chunks (or references) deterministically."
            ),
        ],
    };
}
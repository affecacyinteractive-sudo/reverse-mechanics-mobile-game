// target-validate.ts
// Deterministic step: TARGET-VALIDATE
// Enforces: exactly one Target sleeve, exists, and is usable for expansion to chunks.

import crypto from "node:crypto";
import type { Chunk, ChunkSleeve, ProjectId } from "./types-2";

export interface SleeveStore {
    getSleeveById(args: { project_id: ProjectId; sleeve_id: string }): Promise<ChunkSleeve | null>;
}

export type TargetValidateResult =
    | { ok: true; seals: []; target_sleeve: ChunkSleeve }
    | { ok: false; seals: [Chunk]; target_sleeve: null };

function uuid() {
    return crypto.randomUUID();
}

function makeSeal(title: string, body: string): Chunk {
    return { id: `seal_${uuid()}`, kind: "TEXT", title, body };
}

function wordCount(s: string) {
    return s.trim().split(/\s+/).filter(Boolean).length;
}

function ensureSealBody(body: string) {
    // keep within your TEXT chunk discipline (roughly 20–60 words)
    const wc = wordCount(body);
    if (wc < 20) return body + " Provide exactly one valid target sleeve.";
    if (wc > 60) return body.split(/\s+/).slice(0, 58).join(" ") + ".";
    return body;
}

/**
 * TARGET-VALIDATE:
 * - You already resolved a single sleeve_id (explicit or via TARGET-RESOLVE).
 * - This step ensures it exists and is usable as the ONE Target.
 */
export async function targetValidate(args: {
    project_id: ProjectId;
    target_sleeve_id: string | null | undefined;
    store: SleeveStore;
}): Promise<TargetValidateResult> {
    const { project_id, target_sleeve_id, store } = args;

    if (!target_sleeve_id) {
        return {
            ok: false,
            target_sleeve: null,
            seals: [
                makeSeal(
                    "TARGET_UNUSABLE",
                    ensureSealBody(
                        "Target validation failed: no target sleeve was provided. Target must be exactly one sleeve so the action can operate on a single coherent surface."
                    )
                ),
            ],
        };
    }

    const sleeve = await store.getSleeveById({ project_id, sleeve_id: target_sleeve_id });

    if (!sleeve) {
        return {
            ok: false,
            target_sleeve: null,
            seals: [
                makeSeal(
                    "TARGET_UNUSABLE",
                    ensureSealBody(
                        "Target validation failed: the selected sleeve does not exist or is not accessible. Select a valid target sleeve from prior outputs."
                    )
                ),
            ],
        };
    }

    if (!Array.isArray(sleeve.chunks) || sleeve.chunks.length === 0) {
        return {
            ok: false,
            target_sleeve: null,
            seals: [
                makeSeal(
                    "TARGET_UNUSABLE",
                    ensureSealBody(
                        "Target validation failed: the sleeve contains no chunks. A target sleeve must expand to at least one chunk so the action has grounded context."
                    )
                ),
            ],
        };
    }

    // Minimal hygiene checks (deterministic, non-opinionated)
    const ids = new Set<string>();
    for (const c of sleeve.chunks) {
        if (!c?.id || !c?.kind || !c?.title || typeof c.body !== "string") {
            return {
                ok: false,
                target_sleeve: null,
                seals: [
                    makeSeal(
                        "TARGET_UNUSABLE",
                        ensureSealBody(
                            "Target validation failed: the sleeve contains malformed chunk entries. Ensure each chunk has id, kind, title, and body."
                        )
                    ),
                ],
            };
        }
        if (ids.has(c.id)) {
            return {
                ok: false,
                target_sleeve: null,
                seals: [
                    makeSeal(
                        "TARGET_UNUSABLE",
                        ensureSealBody(
                            "Target validation failed: the sleeve contains duplicate chunk ids. Chunks inside a sleeve must be uniquely identifiable."
                        )
                    ),
                ],
            };
        }
        ids.add(c.id);
    }

    return { ok: true, seals: [], target_sleeve: sleeve };
}
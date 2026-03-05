// chron-append.ts
// Deterministic commit-time append/upsert of ChronicleEntry from RichOutputProse.

import crypto from "crypto";
import type { Chunk, ChronicleEntry, RichOutputProse, RunId, SchoolId } from "./types-2";

/**
 * Minimal store interface (implement with Postgres/Drizzle/etc).
 * Upsert policy: one ChronicleEntry per run_id.
 */
export interface ChronicleStore {
    upsertByRunId(entry: ChronicleEntry): Promise<ChronicleEntry>;
}

/** Return shape mirrors your deterministic-step convention: either entry or a single seal. */
export type ChronAppendResult =
    | { chronicle_entry: ChronicleEntry; seals: [] }
    | { chronicle_entry: null; seals: [Chunk] };

function makeSeal(title: string, body: string): Chunk {
    return {
        id: `seal_${crypto.randomUUID()}`,
        kind: "TEXT",
        title,
        body,
    };
}

/**
 * CHRON-APPEND:
 * - validates rich_output_prose presence
 * - upserts ChronicleEntry keyed by run_id
 * - does NOT invent prose
 */
export async function chronAppend(args: {
    run_id: RunId;
    school: SchoolId;
    rich_output_prose: RichOutputProse | null | undefined;
    store: ChronicleStore;
}): Promise<ChronAppendResult> {
    const { run_id, school, rich_output_prose, store } = args;

    if (!rich_output_prose) {
        return {
            chronicle_entry: null,
            seals: [
                makeSeal(
                    "CHRON_APPEND_UNUSABLE",
                    "Chronicle append skipped: rich_output_prose is missing. Generate RichOutputProse for this run first, then append."
                ),
            ],
        };
    }

    if (rich_output_prose.run_id !== run_id || !rich_output_prose.rop_id) {
        return {
            chronicle_entry: null,
            seals: [
                makeSeal(
                    "CHRON_APPEND_UNUSABLE",
                    "Chronicle append skipped: run_id/rop_id mismatch. Ensure rich_output_prose belongs to this run and has a valid rop_id."
                ),
            ],
        };
    }

    const entry: ChronicleEntry = {
        entry_id: `chron_${crypto.randomUUID()}`,
        run_id,
        school,
        rop_id: rich_output_prose.rop_id,
        anchors: [], // deterministic extractor can fill later; keep empty for now
    };

    const stored = await store.upsertByRunId(entry);
    return { chronicle_entry: stored, seals: [] };
}
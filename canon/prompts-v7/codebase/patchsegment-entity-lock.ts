// patchsegment-entity-lock.ts
// Deterministic step: lock PatchSegment -> {entity_keys_created, entity_keys_touched}
// using (a) CODE-WRITE proposal, (b) commit-time INDEX state (first_seen_run_id),
// and (c) PatchSegment.write_targets as the attribution hint.
//
// This step should run AFTER:
// - CODE-APPEND (so files/versions exist)
// - CODE-INDEX-REFRESH (so new entities have first_seen_run_id = commit_run_id)

import crypto from "node:crypto";
import type {
    Chunk,
    CodeFileVersion,
    EntityKey,
    FilePath,
    IndexEntity,
    PatchSegment,
    PatchSegmentId,
    ProjectId,
    RunId,
} from "./types-2";

export type ProposedCodeChanges = {
    entity_edits: Array<{ file_path: FilePath; entity_key: EntityKey; new_inner_code: string }>;
    entity_inserts: Array<{ file_path: FilePath; entity_key: EntityKey; new_inner_code: string; insert_strategy: "APPEND_END" }>;
    new_files: Array<{ file_path: FilePath; body: string }>;
};

export interface IndexEntityReadStore {
    listEntitiesByFile(args: { project_id: ProjectId; file_path: FilePath }): Promise<IndexEntity[]>;
}

export interface PatchSegmentWriteStore {
    /** Persist the updated patch segment (optional; you can also just return them). */
    upsertPatchSegment(ps: PatchSegment): Promise<void>;
}

export type PatchEntityLockResult =
    | {
    ok: true;
    seals: [];
    updated_patch_segments: PatchSegment[];
    unresolved_patch_segment_ids: PatchSegmentId[];
}
    | {
    ok: false;
    seals: [Chunk];
    updated_patch_segments: [];
    unresolved_patch_segment_ids: PatchSegmentId[];
};

function uuid() {
    return crypto.randomUUID();
}

function makeSeal(title: string, body: string): Chunk {
    return { id: `seal_${uuid()}`, kind: "TEXT", title, body };
}

function uniq<T>(xs: T[]): T[] {
    return [...new Set(xs)];
}

function union<T>(a: T[] | undefined, b: T[] | undefined): T[] {
    return uniq([...(a ?? []), ...(b ?? [])]);
}

function asFilePathFromEntityKey(entity_key: EntityKey): FilePath {
    return entity_key.split("::", 2)[0] as FilePath;
}

/**
 * PATCHSEGMENT → ENTITY LOCK
 *
 * - Uses proposal edits/inserts as "touched" signals
 * - Uses index first_seen_run_id == commit_run_id as "created" signals
 * - Attributes entities to each PatchSegment using write_targets:
 *    - entity_key: that entity (and only that entity)
 *    - file_path/new_file_path: all entities touched/created in that file
 *    - none: if only one patch segment, assign all; otherwise mark unresolved
 */
export async function lockPatchSegmentEntities(args: {
    project_id: ProjectId;
    commit_run_id: RunId;

    patch_segments: PatchSegment[];
    proposed: ProposedCodeChanges | null | undefined;

    /** The versions created in this commit (from CODE-APPEND). */
    created_versions: CodeFileVersion[];

    index: IndexEntityReadStore;

    /** Optional persistence */
    patch_store?: PatchSegmentWriteStore;
}): Promise<PatchEntityLockResult> {
    const { project_id, commit_run_id, patch_segments, proposed, created_versions, index, patch_store } =
        args;

    if (!patch_segments?.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "PATCH_LOCK_UNUSABLE",
                    "Patch→Entity lock skipped: no patch segments provided. Provide patch segments for this commit so we can lock deterministic mappings."
                ),
            ],
            updated_patch_segments: [],
            unresolved_patch_segment_ids: [],
        };
    }

    if (!proposed) {
        // Not fatal for the world, but this lock step can't infer anything without proposal/index.
        // Treat as hard unusable for this deterministic job.
        return {
            ok: false,
            seals: [
                makeSeal(
                    "PATCH_LOCK_UNUSABLE",
                    "Patch→Entity lock skipped: proposed changes missing. Run CODE-WRITE/CODE-VERIFY first (or provide a proposal) so entities can be attributed deterministically."
                ),
            ],
            updated_patch_segments: [],
            unresolved_patch_segment_ids: patch_segments.map((p) => p.id),
        };
    }

    // ----------------------------
    // 1) Build global touched signals from proposal
    // ----------------------------
    const touchedByFile = new Map<FilePath, Set<EntityKey>>();
    const createdByFile = new Map<FilePath, Set<EntityKey>>();

    const noteTouched = (fp: FilePath, ek: EntityKey) => {
        if (!touchedByFile.has(fp)) touchedByFile.set(fp, new Set());
        touchedByFile.get(fp)!.add(ek);
    };
    const noteCreated = (fp: FilePath, ek: EntityKey) => {
        if (!createdByFile.has(fp)) createdByFile.set(fp, new Set());
        createdByFile.get(fp)!.add(ek);
        noteTouched(fp, ek);
    };

    for (const e of proposed.entity_edits ?? []) {
        noteTouched(e.file_path, e.entity_key);
    }
    for (const i of proposed.entity_inserts ?? []) {
        noteCreated(i.file_path, i.entity_key);
    }

    // Files touched in this commit (from created_versions + new_files)
    const touchedFiles = new Set<FilePath>();
    for (const v of created_versions ?? []) touchedFiles.add(v.file_path);
    for (const nf of proposed.new_files ?? []) touchedFiles.add(nf.file_path);
    for (const fp of touchedByFile.keys()) touchedFiles.add(fp);
    for (const fp of createdByFile.keys()) touchedFiles.add(fp);

    // ----------------------------
    // 2) Use INDEX to discover newly created entities in touched files
    //    (first_seen_run_id === commit_run_id)
    // ----------------------------
    for (const fp of touchedFiles) {
        const ents = await index.listEntitiesByFile({ project_id, file_path: fp });
        for (const ent of ents) {
            if (ent.first_seen_run_id === commit_run_id) {
                noteCreated(fp, ent.entity_key);
            }
        }
    }

    // Global sets for quick membership
    const globalTouched = new Set<EntityKey>();
    const globalCreated = new Set<EntityKey>();
    for (const [fp, set] of touchedByFile) for (const ek of set) globalTouched.add(ek);
    for (const [fp, set] of createdByFile) for (const ek of set) globalCreated.add(ek);

    // ----------------------------
    // 3) Attribute entities to patch segments
    // ----------------------------
    const unresolved: PatchSegmentId[] = [];
    const updated: PatchSegment[] = [];

    const onlyOne = patch_segments.length === 1;

    const allTouched = uniq([...globalTouched]);
    const allCreated = uniq([...globalCreated]);

    for (const ps of patch_segments) {
        let inferredTouched: EntityKey[] = [];
        let inferredCreated: EntityKey[] = [];

        const wt = ps.write_targets;

        // Prefer explicit entity_key attribution
        if (wt?.entity_key) {
            const ek = wt.entity_key;
            const fp = wt.file_path ?? asFilePathFromEntityKey(ek);

            // created if globally created
            if (globalCreated.has(ek)) inferredCreated = [ek];
            // touched if globally touched, otherwise still record as touched (explicit target)
            inferredTouched = globalTouched.has(ek) ? [ek] : [ek];

            // small bonus: if proposal touched other entities in same file and there's only one patch segment
            if (onlyOne) {
                const fileTouched = touchedByFile.get(fp);
                const fileCreated = createdByFile.get(fp);
                if (fileTouched) inferredTouched = uniq([...inferredTouched, ...fileTouched]);
                if (fileCreated) inferredCreated = uniq([...inferredCreated, ...fileCreated]);
            }
        }
        // File-scoped attribution
        else if (wt?.file_path || wt?.new_file_path) {
            const fp = (wt.file_path ?? wt.new_file_path) as FilePath;
            inferredTouched = uniq([...(touchedByFile.get(fp) ?? [])]);
            inferredCreated = uniq([...(createdByFile.get(fp) ?? [])]);

            // If file-scoped but nothing found, we still accept empty mapping (file may have no sentinels yet)
            if (!inferredTouched.length && !inferredCreated.length) {
                // leave as empty, but not unresolved if file target was explicit
            }
        }
        // No targets at all
        else {
            if (onlyOne) {
                inferredTouched = allTouched;
                inferredCreated = allCreated;
            } else {
                unresolved.push(ps.id);
            }
        }

        const next: PatchSegment = {
            ...ps,
            // union with any pre-existing mapping (never delete info)
            entity_keys_touched: union(ps.entity_keys_touched, inferredTouched),
            entity_keys_created: union(ps.entity_keys_created, inferredCreated),
        };

        // If we inferred nothing and there were no existing mappings, mark unresolved.
        if (
            (!next.entity_keys_touched || next.entity_keys_touched.length === 0) &&
            (!next.entity_keys_created || next.entity_keys_created.length === 0) &&
            !wt?.entity_key &&
            !wt?.file_path &&
            !wt?.new_file_path &&
            !onlyOne
        ) {
            if (!unresolved.includes(ps.id)) unresolved.push(ps.id);
        }

        // Optional persistence
        if (patch_store) {
            await patch_store.upsertPatchSegment(next);
        }

        updated.push(next);
    }

    return {
        ok: true,
        seals: [],
        updated_patch_segments: updated,
        unresolved_patch_segment_ids: unresolved,
    };
}
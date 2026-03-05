// code-resolve-context.ts
// Deterministic step: resolve PatchSegments -> grounded code context (Packets + base file bodies)
// Uses: types-2.ts contracts for Chunk/PatchSegment/IndexEntity/EntityLocator/CodeFileVersion.

import crypto from "crypto";
import type {
    Chunk,
    CodeBodyLocation,
    CodeFileVersion,
    EntityKey,
    EntityLocator,
    FilePath,
    IndexEntity,
    PatchSegment,
    PatchSegmentId,
    ProjectId,
    RunId,
    VersionId,
} from "./types-2";

// -----------------------------
// Store/IO interfaces (implement in your app)
// -----------------------------

export interface CodebaseStore {
    /** Returns the latest file version with run_id <= at_run_id (tombstone-aware). */
    getFileVersionAtOrBeforeRun(args: {
        project_id: ProjectId;
        file_path: FilePath;
        at_run_id: RunId;
    }): Promise<CodeFileVersion | null>;

    /** Loads the full file body text from the version's body_location (S3/local cache). */
    loadBody(location: CodeBodyLocation): Promise<string>;
}

export interface IndexStore {
    /**
     * Returns the entity record valid at run boundary (latest <= at_run_id),
     * including a locator for the version where the entity exists.
     */
    getEntityAtOrBeforeRun(args: {
        project_id: ProjectId;
        entity_key: EntityKey;
        at_run_id: RunId;
    }): Promise<IndexEntity | null>;
}

// -----------------------------
// Output shape
// -----------------------------

export type ResolvedEntityTarget = {
    entity_key: EntityKey;
    file_path: FilePath;
    locator: EntityLocator;
    version_id: VersionId;
};

export type BaseFile = {
    file_path: FilePath;
    version: CodeFileVersion;
    body: string; // full file text (authoritative for this resolution)
};

export type CodeResolveContextResult =
    | {
    ok: true;
    seals: [];
    packets: Chunk[]; // CODE chunks (entity slices + optional support slices)
    base_files: BaseFile[]; // files whose bodies were loaded (touched by resolved entities)
    resolved_entities: ResolvedEntityTarget[];
    unresolved_patch_segment_ids: PatchSegmentId[];
}
    | {
    ok: false;
    seals: [Chunk];
    packets: [];
    base_files: [];
    resolved_entities: [];
    unresolved_patch_segment_ids: PatchSegmentId[];
};

// -----------------------------
// Helpers
// -----------------------------

function makeId(prefix: string) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function makeSeal(title: string, body: string): Chunk {
    return { id: makeId("seal"), kind: "TEXT", title, body };
}

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

/**
 * Extract by line range (1-based, inclusive). Optionally validate/strip sentinels.
 * If sentinel validation fails, attempts a fallback search by sentinel strings.
 */
function extractEntitySlice(args: {
    body: string;
    locator: EntityLocator;
    include_sentinels: boolean;
}): { slice: string; used_start: number; used_end: number } | null {
    const { body, locator, include_sentinels } = args;

    const lines = body.split(/\r?\n/);
    if (lines.length === 0) return null;

    const start = clamp(locator.start_line, 1, lines.length);
    const end = clamp(locator.end_line, 1, lines.length);
    if (end < start) return null;

    let seg = lines.slice(start - 1, end);

    const hasBegin = seg.some((l) => l.includes(locator.begin_sentinel));
    const hasEnd = seg.some((l) => l.includes(locator.end_sentinel));

    // Fallback: search entire file for sentinel lines if range doesn't include them
    if (!hasBegin || !hasEnd) {
        const beginIdx = lines.findIndex((l) => l.includes(locator.begin_sentinel));
        const endIdx = lines.findIndex((l) => l.includes(locator.end_sentinel));

        if (beginIdx >= 0 && endIdx >= 0 && endIdx >= beginIdx) {
            const fbSeg = lines.slice(beginIdx, endIdx + 1);
            seg = fbSeg;
        } else {
            // Can't trust extraction
            return null;
        }
    }

    if (!include_sentinels) {
        seg = seg.filter(
            (l) =>
                !l.includes(locator.begin_sentinel) &&
                !l.includes(locator.end_sentinel)
        );
    }

    return { slice: seg.join("\n").trimEnd(), used_start: start, used_end: end };
}

function codeChunkTitleFromEntityKey(entity_key: EntityKey): string {
    const [file_path, name] = entity_key.split("::", 2);
    const shortFile = file_path.split("/").slice(-2).join("/");
    return name ? `${shortFile} — ${name}` : shortFile;
}

// -----------------------------
// Main deterministic resolver
// -----------------------------

export async function codeResolveContext(args: {
    project_id: ProjectId;

    /**
     * The run boundary you are patching AGAINST (latest codebase state <= this run).
     * For commit-time, this is typically the last committed run before the new commit.
     */
    at_run_id: RunId;

    /** Patch segments used as anchors (player-selected or commit payload). */
    patch_segments: PatchSegment[];

    /** Stores */
    codebase: CodebaseStore;
    index: IndexStore;

    /** Behavior knobs */
    include_sentinels_in_packets?: boolean; // default: false
    include_file_headers?: boolean; // default: true
    header_lines?: number; // default: 25
    max_packets_total?: number; // default: 12
}): Promise<CodeResolveContextResult> {
    const {
        project_id,
        at_run_id,
        patch_segments,
        codebase,
        index,
        include_sentinels_in_packets = false,
        include_file_headers = true,
        header_lines = 25,
        max_packets_total = 12,
    } = args;

    if (!patch_segments?.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_CONTEXT_UNUSABLE",
                    "Code context resolution skipped: no patch segments were provided. Provide at least one patch segment anchor so code slices can be resolved."
                ),
            ],
            packets: [],
            base_files: [],
            resolved_entities: [],
            unresolved_patch_segment_ids: [],
        };
    }

    // 1) Collect entity keys we should resolve from patch segments
    const entityKeys = new Set<EntityKey>();
    const unresolvedPatchSegIds: PatchSegmentId[] = [];

    for (const ps of patch_segments) {
        const keys =
            ps.entity_keys_touched?.length || ps.entity_keys_created?.length
                ? [...(ps.entity_keys_touched ?? []), ...(ps.entity_keys_created ?? [])]
                : ps.write_targets?.entity_key
                    ? [ps.write_targets.entity_key]
                    : [];

        if (!keys.length) {
            // No deterministic mapping available for this patch segment
            unresolvedPatchSegIds.push(ps.id);
            continue;
        }
        for (const k of keys) entityKeys.add(k);
    }

    if (!entityKeys.size) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_CONTEXT_UNUSABLE",
                    "Code context resolution failed: none of the patch segments map to entity keys yet. Commit-time must lock patch_segment → entity_key mappings (touched/created) for deterministic slicing."
                ),
            ],
            packets: [],
            base_files: [],
            resolved_entities: [],
            unresolved_patch_segment_ids: unresolvedPatchSegIds,
        };
    }

    // 2) Resolve entity locators from INDEX (at run boundary)
    const resolvedEntities: ResolvedEntityTarget[] = [];
    for (const entity_key of entityKeys) {
        const ent = await index.getEntityAtOrBeforeRun({
            project_id,
            entity_key,
            at_run_id,
        });

        if (!ent || ent.status !== "ACTIVE" || !ent.latest_locator) {
            // entity missing/removed at boundary
            continue;
        }

        resolvedEntities.push({
            entity_key,
            file_path: ent.file_path,
            locator: ent.latest_locator,
            version_id: ent.latest_locator.version_id,
        });
    }

    if (!resolvedEntities.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_CONTEXT_UNUSABLE",
                    "Code context resolution failed: no ACTIVE entity locators were found at this run boundary. Ensure the entity index is refreshed after each commit and that selected patch segments point to existing entities."
                ),
            ],
            packets: [],
            base_files: [],
            resolved_entities: [],
            unresolved_patch_segment_ids: unresolvedPatchSegIds,
        };
    }

    // 3) Load base file bodies for the resolved entities (dedupe by file_path+version_id)
    const baseFilesMap = new Map<string, BaseFile>();
    for (const r of resolvedEntities) {
        const key = `${r.file_path}::${r.version_id}`;
        if (baseFilesMap.has(key)) continue;

        const version =
            (await codebase.getFileVersionAtOrBeforeRun({
                project_id,
                file_path: r.file_path,
                at_run_id,
            })) ?? null;

        if (!version || version.is_deleted || !version.body_location) continue;

        const body = await codebase.loadBody(version.body_location);
        baseFilesMap.set(key, { file_path: r.file_path, version, body });
    }

    const base_files = [...baseFilesMap.values()];
    if (!base_files.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_CONTEXT_UNUSABLE",
                    "Code context resolution failed: could not load any base file bodies. Ensure code file versions exist and body_location is readable (S3/cache)."
                ),
            ],
            packets: [],
            base_files: [],
            resolved_entities: [],
            unresolved_patch_segment_ids: unresolvedPatchSegIds,
        };
    }

    // Index base files by file_path for quick lookup
    const latestBodyByFile = new Map<FilePath, string>();
    for (const bf of base_files) latestBodyByFile.set(bf.file_path, bf.body);

    // 4) Build Packet CODE chunks from extracted entity slices (dedupe by entity_key)
    const packets: Chunk[] = [];
    const seenEntity = new Set<EntityKey>();

    for (const r of resolvedEntities) {
        if (seenEntity.has(r.entity_key)) continue;
        seenEntity.add(r.entity_key);

        const body = latestBodyByFile.get(r.file_path);
        if (!body) continue;

        const extracted = extractEntitySlice({
            body,
            locator: r.locator,
            include_sentinels: include_sentinels_in_packets,
        });

        if (!extracted || !extracted.slice.trim()) continue;

        packets.push({
            id: makeId("pkt"),
            kind: "CODE",
            title: codeChunkTitleFromEntityKey(r.entity_key),
            body: extracted.slice,
        });

        if (packets.length >= max_packets_total) break;
    }

    // 5) Optional support: include file header slices (imports/context) for touched files (bounded)
    if (include_file_headers && packets.length < max_packets_total) {
        for (const bf of base_files) {
            if (packets.length >= max_packets_total) break;

            const lines = bf.body.split(/\r?\n/);
            if (!lines.length) continue;

            const header = lines.slice(0, clamp(header_lines, 1, lines.length)).join("\n").trimEnd();
            if (!header) continue;

            packets.push({
                id: makeId("pkt"),
                kind: "CODE",
                title: `${bf.file_path} — header`,
                body: header,
            });
        }
    }

    if (!packets.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_CONTEXT_UNUSABLE",
                    "Code context resolution failed: resolved entities were found, but no extractable code slices were produced. Check sentinel markers, line ranges, and file bodies for the referenced entities."
                ),
            ],
            packets: [],
            base_files: [],
            resolved_entities: [],
            unresolved_patch_segment_ids: unresolvedPatchSegIds,
        };
    }

    return {
        ok: true,
        seals: [],
        packets,
        base_files,
        resolved_entities: resolvedEntities,
        unresolved_patch_segment_ids: unresolvedPatchSegIds,
    };
}
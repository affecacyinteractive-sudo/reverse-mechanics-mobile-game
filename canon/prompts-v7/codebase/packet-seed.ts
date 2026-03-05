// packet-seed.ts
// Deterministic step: PACKET-SEED
// Input: PatchSegments (as anchors) + INDEX + CODEBASE
// Output: Packets[] as grounded CODE chunks (entity slices), without any LLM.
//
// Notes:
// - PatchSegments must already have commit-locked mappings (entity_keys_created/touched) OR an explicit write_targets.entity_key.
// - Extraction is deterministic: sentinel-bounded + line-ranged locators from INDEX, applied to authoritative file bodies.

import crypto from "node:crypto";
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
} from "./types-2";

/* -------------------- IO / store interfaces (implement in your app) -------------------- */

export interface CodebaseStore {
    getFileVersionAtOrBeforeRun(args: {
        project_id: ProjectId;
        file_path: FilePath;
        at_run_id: RunId;
    }): Promise<CodeFileVersion | null>;

    loadBody(location: CodeBodyLocation): Promise<string>;
}

export interface IndexStore {
    getEntityAtOrBeforeRun(args: {
        project_id: ProjectId;
        entity_key: EntityKey;
        at_run_id: RunId;
    }): Promise<IndexEntity | null>;
}

/* -------------------- Output -------------------- */

export type PacketSeedResult =
    | {
    ok: true;
    seals: [];
    packets: Chunk[]; // CODE chunks
    unresolved_patch_segment_ids: PatchSegmentId[];
    resolved_entity_keys: EntityKey[];
}
    | {
    ok: false;
    seals: [Chunk];
    packets: [];
    unresolved_patch_segment_ids: PatchSegmentId[];
    resolved_entity_keys: [];
};

/* -------------------- Helpers -------------------- */

function uuid() {
    return crypto.randomUUID();
}

function makeId(prefix: string) {
    return `${prefix}_${uuid()}`;
}

function makeSeal(title: string, body: string): Chunk {
    return { id: makeId("seal"), kind: "TEXT", title, body };
}

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

function shortFile(file_path: string): string {
    const parts = file_path.split("/");
    return parts.slice(-2).join("/") || file_path;
}

function titleFromEntityKey(entity_key: EntityKey): string {
    const [fp, name] = entity_key.split("::", 2);
    return name ? `${shortFile(fp)} — ${name}` : shortFile(fp);
}

/**
 * Extract entity slice using locator line range, with sentinel validation.
 * Falls back to scanning the file for sentinel lines if the provided range is off.
 */
function extractEntitySlice(args: {
    body: string;
    locator: Pick<EntityLocator, "start_line" | "end_line" | "begin_sentinel" | "end_sentinel">;
    include_sentinels: boolean;
}): string | null {
    const { body, locator, include_sentinels } = args;
    const lines = body.split(/\r?\n/);
    if (!lines.length) return null;

    const start = clamp(locator.start_line, 1, lines.length);
    const end = clamp(locator.end_line, 1, lines.length);
    if (end < start) return null;

    let seg = lines.slice(start - 1, end);
    const hasBegin = seg.some((l) => l.includes(locator.begin_sentinel));
    const hasEnd = seg.some((l) => l.includes(locator.end_sentinel));

    // fallback: find the true sentinel bounds in the file
    if (!hasBegin || !hasEnd) {
        const beginIdx = lines.findIndex((l) => l.includes(locator.begin_sentinel));
        const endIdx = lines.findIndex((l) => l.includes(locator.end_sentinel));
        if (beginIdx >= 0 && endIdx >= 0 && endIdx >= beginIdx) {
            seg = lines.slice(beginIdx, endIdx + 1);
        } else {
            return null;
        }
    }

    if (!include_sentinels) {
        seg = seg.filter(
            (l) => !l.includes(locator.begin_sentinel) && !l.includes(locator.end_sentinel)
        );
    }

    const out = seg.join("\n").trimEnd();
    return out.length ? out : null;
}

function collectEntityKeysFromPatch(ps: PatchSegment): EntityKey[] {
    const fromLocked = [
        ...(ps.entity_keys_touched ?? []),
        ...(ps.entity_keys_created ?? []),
    ];
    const fromTarget = ps.write_targets?.entity_key ? [ps.write_targets.entity_key] : [];
    return [...new Set([...fromLocked, ...fromTarget])];
}

/* -------------------- Main -------------------- */

/**
 * PACKET-SEED:
 * - Resolve PatchSegments -> entity_keys via commit-time locked mapping
 * - Resolve entity_keys -> locators via INDEX at run boundary
 * - Extract entity slices from CODEBASE file bodies at run boundary
 */
export async function packetSeed(args: {
    project_id: ProjectId;
    at_run_id: RunId;

    patch_segments: PatchSegment[];

    index: IndexStore;
    codebase: CodebaseStore;

    include_sentinels_in_packets?: boolean; // default false
    max_packets?: number; // default 12
}): Promise<PacketSeedResult> {
    const {
        project_id,
        at_run_id,
        patch_segments,
        index,
        codebase,
        include_sentinels_in_packets = false,
        max_packets = 12,
    } = args;

    if (!patch_segments?.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "PACKET_SEED_UNUSABLE",
                    "Packet seeding skipped: no patch segments provided. Provide at least one patch segment (or its proxy) so we can deterministically resolve entity slices."
                ),
            ],
            packets: [],
            unresolved_patch_segment_ids: [],
            resolved_entity_keys: [],
        };
    }

    const unresolved_patch_segment_ids: PatchSegmentId[] = [];

    // 1) Gather entity keys from patch segments
    const entityKeys = new Set<EntityKey>();
    for (const ps of patch_segments) {
        const keys = collectEntityKeysFromPatch(ps);
        if (!keys.length) {
            unresolved_patch_segment_ids.push(ps.id);
            continue;
        }
        for (const k of keys) entityKeys.add(k);
    }

    if (!entityKeys.size) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "PACKET_SEED_UNUSABLE",
                    "Packet seeding failed: none of the patch segments map to entity keys. Ensure commit-time locks patch_segment → entity_keys_touched/created (or sets write_targets.entity_key)."
                ),
            ],
            packets: [],
            unresolved_patch_segment_ids,
            resolved_entity_keys: [],
        };
    }

    // 2) Resolve entity keys to locators (must be ACTIVE)
    type Resolved = { entity_key: EntityKey; file_path: FilePath; locator: EntityLocator };
    const resolved: Resolved[] = [];

    for (const entity_key of entityKeys) {
        const ent = await index.getEntityAtOrBeforeRun({ project_id, entity_key, at_run_id });
        if (!ent || ent.status !== "ACTIVE" || !ent.latest_locator) continue;
        resolved.push({ entity_key, file_path: ent.file_path, locator: ent.latest_locator });
    }

    if (!resolved.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "PACKET_SEED_UNUSABLE",
                    "Packet seeding failed: no ACTIVE entity locators found at this run boundary. Ensure code index refresh runs after each commit and that selected patch segments point to existing entities."
                ),
            ],
            packets: [],
            unresolved_patch_segment_ids,
            resolved_entity_keys: [],
        };
    }

    // 3) Load file bodies (dedupe by file_path) and extract slices
    const bodyByFile = new Map<FilePath, { version: CodeFileVersion; body: string }>();
    const packets: Chunk[] = [];
    const resolved_entity_keys: EntityKey[] = [];

    for (const r of resolved) {
        if (packets.length >= max_packets) break;

        if (!bodyByFile.has(r.file_path)) {
            const v = await codebase.getFileVersionAtOrBeforeRun({
                project_id,
                file_path: r.file_path,
                at_run_id,
            });

            if (!v || v.is_deleted || !v.body_location) continue;

            const body = await codebase.loadBody(v.body_location);
            bodyByFile.set(r.file_path, { version: v, body });
        }

        const file = bodyByFile.get(r.file_path);
        if (!file) continue;

        // Optional integrity check; do not fail hard (still deterministic read).
        // If you want hard-fail, convert this to a seal.
        if (r.locator.source_body_sha256 && file.version.body_sha256 && r.locator.source_body_sha256 !== file.version.body_sha256) {
            // mismatch: proceed anyway; locator fallback uses sentinel scan
        }

        const slice = extractEntitySlice({
            body: file.body,
            locator: r.locator,
            include_sentinels: include_sentinels_in_packets,
        });

        if (!slice) continue;

        packets.push({
            id: makeId("pkt"),
            kind: "CODE",
            title: titleFromEntityKey(r.entity_key),
            body: slice,
        });
        resolved_entity_keys.push(r.entity_key);
    }

    if (!packets.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "PACKET_SEED_UNUSABLE",
                    "Packet seeding failed: entities resolved, but no extractable code slices were produced. Check sentinel markers and locator line ranges for the referenced entities."
                ),
            ],
            packets: [],
            unresolved_patch_segment_ids,
            resolved_entity_keys: [],
        };
    }

    return {
        ok: true,
        seals: [],
        packets,
        unresolved_patch_segment_ids,
        resolved_entity_keys,
    };
}
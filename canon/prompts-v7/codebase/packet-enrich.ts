// packet-enrich.ts
// Deterministic step: PACKET-ENRICH (bounded)
// Adds a small, bounded amount of support context to seed Packets[].
//
// Strategy (deterministic):
// 1) For each file touched by seed entity keys:
//    - add a "header" packet (top-of-file preamble up to first sentinel, bounded)
// 2) For each seed entity in a file:
//    - add neighbor entity packets (prev/next by start_line), bounded
//
// Notes:
// - No LLM here.
// - Does NOT assume Index can list all entities; it parses the authoritative file body for sentinels.
// - Seed packets remain untouched; enrich only appends additional CODE packets.

import crypto from "node:crypto";
import type {
    Chunk,
    CodeBodyLocation,
    CodeFileVersion,
    EntityKey,
    FilePath,
    ProjectId,
    RunId,
} from "./types-2";

/* -------------------- IO interfaces (implement in your app) -------------------- */

export interface CodebaseStore {
    getFileVersionAtOrBeforeRun(args: {
        project_id: ProjectId;
        file_path: FilePath;
        at_run_id: RunId;
    }): Promise<CodeFileVersion | null>;

    loadBody(location: CodeBodyLocation): Promise<string>;
}

/* -------------------- Output -------------------- */

export type PacketEnrichResult =
    | {
    ok: true;
    seals: [];
    packets: Chunk[]; // seed + auto-added
    auto_added_packet_ids: string[];
    auto_added_entity_keys: EntityKey[];
    auto_added_file_paths: FilePath[];
}
    | {
    ok: false;
    seals: [Chunk];
    packets: [];
    auto_added_packet_ids: [];
    auto_added_entity_keys: [];
    auto_added_file_paths: [];
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

// Sentinel marker regex (works regardless of comment wrapper)
const BEGIN_RE = /\[RM:BEGIN\s+entity_key=([^\]]+)\]/;
const END_RE = /\[RM:END\s+entity_key=([^\]]+)\]/;

type ParsedEntity = {
    entity_key: EntityKey;
    start_line: number; // 1-based
    end_line: number; // 1-based
    begin_marker: string; // raw marker string e.g. "[RM:BEGIN entity_key=...]"
    end_marker: string;   // raw marker string e.g. "[RM:END entity_key=...]"
};

function parseEntitiesFromBody(body: string): ParsedEntity[] {
    const lines = body.split(/\r?\n/);
    const stack: Array<{ entity_key: EntityKey; start_line: number; begin_marker: string }> = [];
    const out: ParsedEntity[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const b = line.match(BEGIN_RE);
        if (b) {
            const entity_key = b[1] as EntityKey;
            stack.push({
                entity_key,
                start_line: i + 1,
                begin_marker: `[RM:BEGIN entity_key=${entity_key}]`,
            });
            continue;
        }

        const e = line.match(END_RE);
        if (e) {
            const entity_key = e[1] as EntityKey;
            const top = stack.pop();
            if (!top) continue;
            if (top.entity_key !== entity_key) continue; // mismatched; ignore pair
            out.push({
                entity_key,
                start_line: top.start_line,
                end_line: i + 1,
                begin_marker: top.begin_marker,
                end_marker: `[RM:END entity_key=${entity_key}]`,
            });
        }
    }

    // Dedup by entity_key (keep first) and sort by start_line for stable neighbor selection
    const seen = new Set<EntityKey>();
    const deduped: ParsedEntity[] = [];
    for (const ent of out.sort((a, b) => a.start_line - b.start_line)) {
        if (seen.has(ent.entity_key)) continue;
        seen.add(ent.entity_key);
        deduped.push(ent);
    }
    return deduped;
}

function extractByLineRange(args: {
    body: string;
    start_line: number;
    end_line: number;
    include_sentinels: boolean;
    begin_marker?: string;
    end_marker?: string;
}): string | null {
    const { body, start_line, end_line, include_sentinels, begin_marker, end_marker } = args;
    const lines = body.split(/\r?\n/);
    if (!lines.length) return null;

    const s = clamp(start_line, 1, lines.length);
    const e = clamp(end_line, 1, lines.length);
    if (e < s) return null;

    let seg = lines.slice(s - 1, e);

    if (!include_sentinels && (begin_marker || end_marker)) {
        seg = seg.filter((l) => {
            if (begin_marker && l.includes(begin_marker)) return false;
            if (end_marker && l.includes(end_marker)) return false;
            return true;
        });
    }

    const out = seg.join("\n").trimEnd();
    return out.length ? out : null;
}

function filePathFromEntityKey(entity_key: EntityKey): FilePath {
    return entity_key.split("::", 2)[0] as FilePath;
}

/* -------------------- Main -------------------- */

export async function packetEnrich(args: {
    project_id: ProjectId;
    at_run_id: RunId;

    /** Seed packets from PACKET-SEED (already grounded entity slices). */
    seed_packets: Chunk[];

    /** The entity keys that were resolved/used to seed packets (from PACKET-SEED). */
    seed_entity_keys: EntityKey[];

    codebase: CodebaseStore;

    opts?: {
        include_sentinels_in_packets?: boolean; // default false
        max_total_packets?: number; // default 12 (seed + auto)
        max_auto_packets?: number; // default 6
        header_lines?: number; // default 40
        neighbor_each_side?: number; // default 1 (prev + next)
        max_files_for_headers?: number; // default 3
    };
}): Promise<PacketEnrichResult> {
    const {
        project_id,
        at_run_id,
        seed_packets,
        seed_entity_keys,
        codebase,
        opts,
    } = args;

    const include_sentinels_in_packets = opts?.include_sentinels_in_packets ?? false;
    const max_total_packets = opts?.max_total_packets ?? 12;
    const max_auto_packets = opts?.max_auto_packets ?? 6;
    const header_lines = opts?.header_lines ?? 40;
    const neighbor_each_side = opts?.neighbor_each_side ?? 1;
    const max_files_for_headers = opts?.max_files_for_headers ?? 3;

    if (!seed_packets?.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "PACKET_ENRICH_UNUSABLE",
                    "Packet enrich skipped: seed packets are missing. Run PACKET-SEED first to produce grounded entity slices, then enrich deterministically."
                ),
            ],
            packets: [],
            auto_added_packet_ids: [],
            auto_added_entity_keys: [],
            auto_added_file_paths: [],
        };
    }

    if (!seed_entity_keys?.length) {
        // Still allow: return seed packets unchanged (enrich requires targets to add neighbors/headers)
        return {
            ok: true,
            seals: [],
            packets: seed_packets.slice(0, max_total_packets),
            auto_added_packet_ids: [],
            auto_added_entity_keys: [],
            auto_added_file_paths: [],
        };
    }

    // Bound: never exceed max_total_packets
    const seedLimited = seed_packets.slice(0, max_total_packets);
    const remainingBudget = Math.max(0, max_total_packets - seedLimited.length);
    const autoBudget = Math.min(max_auto_packets, remainingBudget);

    if (autoBudget === 0) {
        return {
            ok: true,
            seals: [],
            packets: seedLimited,
            auto_added_packet_ids: [],
            auto_added_entity_keys: [],
            auto_added_file_paths: [],
        };
    }

    // Load file bodies for touched files
    const touchedFiles = [...new Set(seed_entity_keys.map(filePathFromEntityKey))];

    const bodies = new Map<FilePath, { version: CodeFileVersion; body: string; entities: ParsedEntity[] }>();

    for (const fp of touchedFiles) {
        const v = await codebase.getFileVersionAtOrBeforeRun({ project_id, file_path: fp, at_run_id });
        if (!v || v.is_deleted || !v.body_location) continue;

        const body = await codebase.loadBody(v.body_location);
        const entities = parseEntitiesFromBody(body);
        bodies.set(fp, { version: v, body, entities });
    }

    if (!bodies.size) {
        // Nothing to enrich with; return seed
        return {
            ok: true,
            seals: [],
            packets: seedLimited,
            auto_added_packet_ids: [],
            auto_added_entity_keys: [],
            auto_added_file_paths: [],
        };
    }

    const autoPackets: Chunk[] = [];
    const auto_added_packet_ids: string[] = [];
    const auto_added_entity_keys: EntityKey[] = [];
    const auto_added_file_paths: FilePath[] = [];

    const alreadyHasTitle = new Set(seedLimited.map((p) => p.title));
    const alreadyEntity = new Set(seed_entity_keys);

    // 1) Add bounded file headers (imports/preamble)
    for (const fp of touchedFiles.slice(0, max_files_for_headers)) {
        if (autoPackets.length >= autoBudget) break;
        const fb = bodies.get(fp);
        if (!fb) continue;

        const lines = fb.body.split(/\r?\n/);
        if (!lines.length) continue;

        // Prefer "preamble until first BEGIN", bounded by header_lines
        const firstBeginIdx = lines.findIndex((l) => BEGIN_RE.test(l));
        const cutoff = firstBeginIdx > 0 ? Math.min(firstBeginIdx, header_lines) : header_lines;

        const header = lines.slice(0, clamp(cutoff, 1, lines.length)).join("\n").trimEnd();
        if (!header) continue;

        const title = `[AUTO] ${fp} — header`;
        if (alreadyHasTitle.has(title)) continue;

        const pkt: Chunk = { id: makeId("pkt"), kind: "CODE", title, body: header };
        autoPackets.push(pkt);
        auto_added_packet_ids.push(pkt.id);
        auto_added_file_paths.push(fp);
        alreadyHasTitle.add(title);
    }

    // 2) Add neighbor entities (prev/next) per seed entity, bounded
    // Build a quick lookup: file -> entity list
    const entitiesByFile = new Map<FilePath, ParsedEntity[]>();
    for (const [fp, fb] of bodies.entries()) entitiesByFile.set(fp, fb.entities);

    for (const seedKey of seed_entity_keys) {
        if (autoPackets.length >= autoBudget) break;

        const fp = filePathFromEntityKey(seedKey);
        const list = entitiesByFile.get(fp);
        const fb = bodies.get(fp);
        if (!list?.length || !fb) continue;

        const idx = list.findIndex((e) => e.entity_key === seedKey);
        if (idx < 0) continue;

        const candidates: ParsedEntity[] = [];

        for (let d = 1; d <= neighbor_each_side; d++) {
            const prev = list[idx - d];
            const next = list[idx + d];
            if (prev) candidates.push(prev);
            if (next) candidates.push(next);
        }

        for (const c of candidates) {
            if (autoPackets.length >= autoBudget) break;
            if (alreadyEntity.has(c.entity_key)) continue; // already in seed
            alreadyEntity.add(c.entity_key);

            const slice = extractByLineRange({
                body: fb.body,
                start_line: c.start_line,
                end_line: c.end_line,
                include_sentinels: include_sentinels_in_packets,
                begin_marker: c.begin_marker,
                end_marker: c.end_marker,
            });
            if (!slice) continue;

            const title = `[AUTO] ${titleFromEntityKey(c.entity_key)}`;
            if (alreadyHasTitle.has(title)) continue;

            const pkt: Chunk = { id: makeId("pkt"), kind: "CODE", title, body: slice };
            autoPackets.push(pkt);
            auto_added_packet_ids.push(pkt.id);
            auto_added_entity_keys.push(c.entity_key);
            auto_added_file_paths.push(fp);
            alreadyHasTitle.add(title);
        }
    }

    const packets = [...seedLimited, ...autoPackets].slice(0, max_total_packets);

    return {
        ok: true,
        seals: [],
        packets,
        auto_added_packet_ids,
        auto_added_entity_keys,
        auto_added_file_paths: [...new Set(auto_added_file_paths)],
    };
}
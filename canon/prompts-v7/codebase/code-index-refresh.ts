// code-index-refresh.ts
// Deterministic step: refresh INDEX (IndexFile + IndexEntity) from newly appended CodeFileVersion(s).
// - Parses RM sentinel markers to build EntityLocator (sentinel + 1-based line ranges).
// - Marks entities ACTIVE/REMOVED for the updated files.
// - Updates IndexFile latest pointers + simple deterministic summary/handles.
// LLM summaries are OPTIONAL; this file uses deterministic summaries by default.

import crypto from "node:crypto";
import type {
    Chunk,
    CodeBodyLocation,
    CodeFileVersion,
    EntityKey,
    EntityLocator,
    FilePath,
    IndexEntity,
    IndexFile,
    ProjectId,
    RunId,
    VersionId,
} from "./types-2";

/* -------------------- Store Interfaces (implement with Postgres/Drizzle etc.) -------------------- */

export interface CodeBodyReader {
    loadBody(location: CodeBodyLocation): Promise<string>;
}

export interface IndexWriteStore {
    // File index
    getIndexFile(args: { project_id: ProjectId; file_path: FilePath }): Promise<IndexFile | null>;
    upsertIndexFile(file: IndexFile): Promise<void>;

    // Entity index
    listEntitiesByFile(args: { project_id: ProjectId; file_path: FilePath }): Promise<IndexEntity[]>;
    upsertIndexEntity(entity: IndexEntity): Promise<void>;
}

/* -------------------- Optional LLM summary hook -------------------- */

export interface OptionalSummaryProvider {
    summarizeFile?(args: {
        file_path: FilePath;
        entity_names: string[];
        body_preview: string; // short preview for optional LLM summary
    }): Promise<{ summary: string; handles: string[] }>;
}

/* -------------------- Output -------------------- */

export type CodeIndexRefreshResult =
    | {
    ok: true;
    seals: [];
    updated_files: FilePath[];
    upserted_entities: EntityKey[];
    removed_entities: EntityKey[];
}
    | {
    ok: false;
    seals: [Chunk];
    updated_files: [];
    upserted_entities: [];
    removed_entities: [];
};

/* -------------------- Helpers -------------------- */

function uuid() {
    return crypto.randomUUID();
}

function isoNow(): string {
    return new Date().toISOString();
}

function makeSeal(title: string, body: string): Chunk {
    return { id: `seal_${uuid()}`, kind: "TEXT", title, body };
}

function basename(file_path: string): string {
    const parts = file_path.split("/");
    return parts[parts.length - 1] ?? file_path;
}

// Matches marker string inside any wrapper comment, e.g. `// [RM:BEGIN entity_key=...]`
const BEGIN_RE = /\[RM:BEGIN\s+entity_key=([^\]]+)\]/;
const END_RE = /\[RM:END\s+entity_key=([^\]]+)\]/;

type ParsedEntity = {
    entity_key: EntityKey;
    file_path: FilePath;
    entity_name: string;
    locator: EntityLocator;
};

function parseEntitiesFromBody(args: {
    file_path: FilePath;
    version_id: VersionId;
    source_body_sha256: string;
    body: string;
}): { entities: ParsedEntity[]; warnings: string[] } {
    const { file_path, version_id, source_body_sha256, body } = args;

    const lines = body.split(/\r?\n/);
    const warnings: string[] = [];

    // stack of begins (to pair begins/ends deterministically)
    const stack: Array<{ entity_key: EntityKey; begin_line_1b: number; begin_sentinel: string }> = [];
    const out: ParsedEntity[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const b = line.match(BEGIN_RE);
        if (b) {
            const entity_key = b[1] as EntityKey;
            stack.push({
                entity_key,
                begin_line_1b: i + 1,
                begin_sentinel: `[RM:BEGIN entity_key=${entity_key}]`,
            });
            continue;
        }

        const e = line.match(END_RE);
        if (e) {
            const entity_key = e[1] as EntityKey;
            const top = stack.pop();

            if (!top) {
                warnings.push(`END without BEGIN for ${entity_key} in ${file_path}`);
                continue;
            }
            if (top.entity_key !== entity_key) {
                warnings.push(
                    `Mismatched sentinels in ${file_path}: BEGIN ${top.entity_key} closed by END ${entity_key}`
                );
                // attempt recovery: do not emit a locator from a mismatched pair
                continue;
            }

            const end_line_1b = i + 1;
            const entity_name = entity_key.split("::", 2)[1] ?? entity_key;

            out.push({
                entity_key,
                file_path,
                entity_name,
                locator: {
                    version_id,
                    source_body_sha256,
                    start_line: top.begin_line_1b,
                    end_line: end_line_1b,
                    begin_sentinel: top.begin_sentinel,
                    end_sentinel: `[RM:END entity_key=${entity_key}]`,
                },
            });
        }
    }

    if (stack.length) {
        for (const unclosed of stack) {
            warnings.push(`BEGIN without END for ${unclosed.entity_key} in ${file_path}`);
        }
    }

    // If duplicates exist, keep the first occurrence and warn.
    const seen = new Set<EntityKey>();
    const deduped: ParsedEntity[] = [];
    for (const ent of out) {
        if (seen.has(ent.entity_key)) {
            warnings.push(`Duplicate entity_key in ${file_path}: ${ent.entity_key}`);
            continue;
        }
        seen.add(ent.entity_key);
        deduped.push(ent);
    }

    return { entities: deduped, warnings };
}

function deterministicFileHandles(file_path: FilePath, entity_names: string[]): string[] {
    const handles = new Set<string>();
    handles.add(basename(file_path));
    // add a couple of entity names as cheap retrieval handles
    for (const n of entity_names.slice(0, 12)) handles.add(n);
    return [...handles];
}

function deterministicFileSummary(file_path: FilePath, entity_names: string[]): string {
    if (!entity_names.length) return `File: ${file_path}\nNo indexed entities.`;
    const sample = entity_names.slice(0, 6).join(", ");
    const more = entity_names.length > 6 ? ` (+${entity_names.length - 6} more)` : "";
    return `File: ${file_path}\nEntities: ${sample}${more}`;
}

function deterministicEntityHandles(entity_name: string): string[] {
    // Keep it intentionally conservative; avoid trying to infer selectors.
    return [entity_name];
}

/* -------------------- Main -------------------- */

export async function codeIndexRefresh(args: {
    project_id: ProjectId;

    /**
     * Versions created by CODE-APPEND for this commit run.
     * (Pass tombstones too, if you implement deletes.)
     */
    created_versions: CodeFileVersion[];

    body_reader: CodeBodyReader;
    index_store: IndexWriteStore;

    /** Optional LLM summary provider; if not provided, deterministic summaries are used. */
    summary_provider?: OptionalSummaryProvider;

    /** How much body to include in optional file summarizer. */
    body_preview_lines?: number;
}): Promise<CodeIndexRefreshResult> {
    const {
        project_id,
        created_versions,
        body_reader,
        index_store,
        summary_provider,
        body_preview_lines = 60,
    } = args;

    if (!created_versions?.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_INDEX_UNUSABLE",
                    "Index refresh skipped: no created file versions were provided. Run CODE-APPEND first and pass the created_versions."
                ),
            ],
            updated_files: [],
            upserted_entities: [],
            removed_entities: [],
        };
    }

    const updated_files: FilePath[] = [];
    const upserted_entities: EntityKey[] = [];
    const removed_entities: EntityKey[] = [];

    for (const v of created_versions) {
        const file_path = v.file_path;
        updated_files.push(file_path);

        // Update IndexFile even for tombstones.
        if (v.is_deleted) {
            const fileRow: IndexFile = {
                project_id,
                file_path,
                latest_run_id: v.run_id,
                latest_version_id: v.version_id,
                status: "DELETED",
                summary: `File: ${file_path}\nDeleted in ${v.run_id}.`,
                handles: [basename(file_path)],
                updated_at: isoNow(),
            };
            await index_store.upsertIndexFile(fileRow);

            // Mark all entities from this file as REMOVED (best-effort).
            const existing = await index_store.listEntitiesByFile({ project_id, file_path });
            for (const ent of existing) {
                if (ent.status === "ACTIVE") {
                    const removed: IndexEntity = {
                        ...ent,
                        status: "REMOVED",
                        latest_seen_run_id: v.run_id,
                        latest_locator: undefined,
                        updated_at: isoNow(),
                    };
                    await index_store.upsertIndexEntity(removed);
                    removed_entities.push(ent.entity_key);
                }
            }
            continue;
        }

        if (!v.body_location || !v.body_sha256) {
            // Index cannot be refreshed without the authoritative body pointer + hash
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_INDEX_UNUSABLE",
                        `Index refresh blocked: missing body_location/body_sha256 for ${file_path}. Ensure CODE-APPEND stored body pointers and hashes.`
                    ),
                ],
                updated_files: [],
                upserted_entities: [],
                removed_entities: [],
            };
        }

        const body = await body_reader.loadBody(v.body_location);

        const { entities: parsed, warnings } = parseEntitiesFromBody({
            file_path,
            version_id: v.version_id,
            source_body_sha256: v.body_sha256,
            body,
        });

        // Fetch existing entities for this file to update ACTIVE/REMOVED.
        const existing = await index_store.listEntitiesByFile({ project_id, file_path });
        const existingByKey = new Map<EntityKey, IndexEntity>();
        for (const e of existing) existingByKey.set(e.entity_key, e);

        const parsedKeys = new Set<EntityKey>(parsed.map((p) => p.entity_key));

        // Upsert ACTIVE (and re-activate if previously removed).
        for (const p of parsed) {
            const prev = existingByKey.get(p.entity_key);

            const next: IndexEntity = prev
                ? {
                    ...prev,
                    entity_name: p.entity_name,
                    handles: prev.handles?.length ? prev.handles : deterministicEntityHandles(p.entity_name),
                    latest_seen_run_id: v.run_id,
                    status: "ACTIVE",
                    latest_locator: p.locator,
                    updated_at: isoNow(),
                }
                : {
                    project_id,
                    entity_key: p.entity_key,
                    file_path: p.file_path,
                    entity_name: p.entity_name,
                    handles: deterministicEntityHandles(p.entity_name),
                    first_seen_run_id: v.run_id,
                    latest_seen_run_id: v.run_id,
                    status: "ACTIVE",
                    latest_locator: p.locator,
                    updated_at: isoNow(),
                };

            await index_store.upsertIndexEntity(next);
            upserted_entities.push(p.entity_key);
        }

        // Mark REMOVED for entities that were ACTIVE but no longer present.
        for (const prev of existing) {
            if (prev.status !== "ACTIVE") continue;
            if (parsedKeys.has(prev.entity_key)) continue;

            const removed: IndexEntity = {
                ...prev,
                status: "REMOVED",
                latest_seen_run_id: v.run_id,
                latest_locator: undefined,
                updated_at: isoNow(),
            };
            await index_store.upsertIndexEntity(removed);
            removed_entities.push(prev.entity_key);
        }

        // Update IndexFile (summary/handles deterministic or optional LLM).
        const entityNames = parsed.map((p) => p.entity_name);
        const preview = body.split(/\r?\n/).slice(0, body_preview_lines).join("\n");

        let summary = deterministicFileSummary(file_path, entityNames);
        let handles = deterministicFileHandles(file_path, entityNames);

        if (summary_provider?.summarizeFile) {
            try {
                const s = await summary_provider.summarizeFile({
                    file_path,
                    entity_names: entityNames,
                    body_preview: preview,
                });
                if (s?.summary) summary = s.summary;
                if (s?.handles?.length) handles = s.handles;
            } catch {
                // keep deterministic defaults
            }
        }

        const fileRow: IndexFile = {
            project_id,
            file_path,
            latest_run_id: v.run_id,
            latest_version_id: v.version_id,
            status: "ACTIVE",
            summary,
            handles,
            updated_at: isoNow(),
        };
        await index_store.upsertIndexFile(fileRow);

        // If warnings exist, we do NOT fail the refresh (commit already passed verify),
        // but you may want to log them. If you want hard-fail, change this behavior.
        if (warnings.length) {
            // noop: keep deterministic behavior (caller can log warnings if desired)
        }
    }

    return {
        ok: true,
        seals: [],
        updated_files,
        upserted_entities,
        removed_entities,
    };
}
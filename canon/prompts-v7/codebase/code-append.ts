// code-append.ts
// Deterministic commit-time append of new immutable CodeFileVersion(s).
// Applies CODE-WRITE "proposed" edits to base file bodies using sentinels, then persists bodies
// to storage (S3/local cache) and writes version metadata rows.
//
// Assumes CODE-VERIFY (and optional tool-check) already passed.
// No LLM usage here.

import crypto from "node:crypto";
import type {
    Chunk,
    CodeBodyLocation,
    CodeFileVersion,
    EntityKey,
    EntityLocator,
    FilePath,
    ProjectId,
    RunId,
    VersionId,
} from "./types-2";

export type ProposedCodeChanges = {
    entity_edits: Array<{
        file_path: FilePath;
        entity_key: EntityKey;
        new_inner_code: string; // MUST NOT include sentinel lines
    }>;
    entity_inserts: Array<{
        file_path: FilePath;
        entity_key: EntityKey;
        new_inner_code: string; // MUST NOT include sentinel lines
        insert_strategy: "APPEND_END";
    }>;
    new_files: Array<{
        file_path: FilePath;
        body: string; // full file body
    }>;
};

export type BaseFile = {
    file_path: FilePath;
    version_id: VersionId;
    body_sha256: string;
    body: string; // full authoritative file text at base boundary
};

export type CodeAppendResult =
    | {
    ok: true;
    seals: [];
    created_versions: CodeFileVersion[];
    skipped_unchanged_files: FilePath[];
}
    | {
    ok: false;
    seals: [Chunk];
    created_versions: [];
    skipped_unchanged_files: FilePath[];
};

// ---- Storage / DB interfaces (implement with your infra) ----

/**
 * Persists a full file body for the new version and returns its location.
 * You can implement this using:
 * - S3: key like `projects/<pid>/runs/<run>/files/<file_path>`
 * - local cache: relpath like `codebase/v/<version_id>.txt`
 */
export interface CodeBodyStore {
    putBody(args: {
        project_id: ProjectId;
        run_id: RunId;
        version_id: VersionId;
        file_path: FilePath;
        body: string;
    }): Promise<CodeBodyLocation>;
}

export interface CodeVersionStore {
    /** Insert the version metadata row (immutable). */
    insertVersion(v: CodeFileVersion): Promise<void>;
}

// ---- Helpers ----

function uuid(): string {
    return crypto.randomUUID();
}

function isoNow(): string {
    return new Date().toISOString();
}

function sha256Hex(text: string): string {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function makeSeal(title: string, body: string): Chunk {
    return {
        id: `seal_${uuid()}`,
        kind: "TEXT",
        title,
        body,
    };
}

function fileExt(file_path: string): string {
    const m = file_path.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : "";
}

/**
 * Render a full sentinel line containing the marker.
 * We assume your locator markers look like: "[RM:BEGIN entity_key=...]" etc.
 * We wrap them in a comment appropriate to the file type.
 */
function renderSentinelLine(file_path: FilePath, marker: string): string {
    const ext = fileExt(file_path);
    if (ext === "html" || ext === "htm") return `<!-- ${marker} -->`;
    if (ext === "css") return `/* ${marker} */`;
    // default to line comment (ts/tsx/js/tsx/jsonc/etc.)
    return `// ${marker}`;
}

/** Default marker strings for new entities if you don't already have a locator for them. */
function defaultMarkers(entity_key: EntityKey): { begin: string; end: string } {
    return {
        begin: `[RM:BEGIN entity_key=${entity_key}]`,
        end: `[RM:END entity_key=${entity_key}]`,
    };
}

/**
 * Replace inner region between begin/end sentinel lines.
 * Searches by substring includes(marker), so it works even if sentinel lines are wrapped.
 */
function applyEntityEdit(args: {
    file_path: FilePath;
    body: string;
    locator: Pick<EntityLocator, "begin_sentinel" | "end_sentinel">;
    new_inner_code: string;
}): { ok: true; body: string } | { ok: false; reason: string } {
    const { file_path, body, locator, new_inner_code } = args;

    const lines = body.split(/\r?\n/);
    const beginIdx = lines.findIndex((l) => l.includes(locator.begin_sentinel));
    if (beginIdx < 0) {
        return { ok: false, reason: `BEGIN sentinel not found for ${file_path}` };
    }
    const endIdx = lines.findIndex(
        (l, i) => i > beginIdx && l.includes(locator.end_sentinel)
    );
    if (endIdx < 0) {
        return { ok: false, reason: `END sentinel not found for ${file_path}` };
    }
    if (endIdx < beginIdx) {
        return { ok: false, reason: `Invalid sentinel ordering for ${file_path}` };
    }

    // Hygiene: ensure inner code contains no marker lines
    if (
        new_inner_code.includes("[RM:BEGIN") ||
        new_inner_code.includes("[RM:END") ||
        new_inner_code.includes("RM:BEGIN") ||
        new_inner_code.includes("RM:END") ||
        new_inner_code.includes("```")
    ) {
        return { ok: false, reason: `new_inner_code contains forbidden sentinel/markdown` };
    }

    const innerLines =
        new_inner_code.trimEnd().length === 0 ? [] : new_inner_code.split(/\r?\n/);

    const out: string[] = [];
    out.push(...lines.slice(0, beginIdx + 1));
    out.push(...innerLines);
    out.push(...lines.slice(endIdx)); // includes end sentinel line onward

    return { ok: true, body: out.join("\n") };
}

/**
 * Insert a new entity block at end of file (APPEND_END).
 * Deterministic: add a blank line before block if file not empty.
 */
function applyEntityInsert(args: {
    file_path: FilePath;
    body: string;
    entity_key: EntityKey;
    new_inner_code: string;
}): { ok: true; body: string } | { ok: false; reason: string } {
    const { file_path, body, entity_key, new_inner_code } = args;

    if (
        new_inner_code.includes("[RM:BEGIN") ||
        new_inner_code.includes("[RM:END") ||
        new_inner_code.includes("RM:BEGIN") ||
        new_inner_code.includes("RM:END") ||
        new_inner_code.includes("```")
    ) {
        return { ok: false, reason: `new_inner_code contains forbidden sentinel/markdown` };
    }

    // Avoid duplicate entity_key insert if markers already present
    const { begin, end } = defaultMarkers(entity_key);
    if (body.includes(begin) || body.includes(end)) {
        return { ok: false, reason: `Entity markers already present for ${entity_key}` };
    }

    const beginLine = renderSentinelLine(file_path, begin);
    const endLine = renderSentinelLine(file_path, end);

    const trimmed = body.replace(/\s+$/g, ""); // keep internal newlines, trim tail whitespace
    const outParts: string[] = [];

    if (trimmed.length > 0) outParts.push(trimmed);
    // Ensure a blank line before new block
    if (outParts.length > 0) outParts.push("");
    outParts.push(beginLine);

    const inner = new_inner_code.trimEnd();
    if (inner.length > 0) outParts.push(...inner.split(/\r?\n/));

    outParts.push(endLine);

    // End with newline for nicer diffs
    return { ok: true, body: outParts.join("\n") + "\n" };
}

// ---- Main ----

export async function codeAppend(args: {
    project_id: ProjectId;
    commit_run_id: RunId;

    /** Base boundary files (the code state you patched against). */
    base_files: BaseFile[];

    /** Locators for entities you might edit (from index at base boundary). */
    entity_locators: Array<
        Pick<EntityLocator, "version_id" | "source_body_sha256" | "begin_sentinel" | "end_sentinel"> & {
        entity_key: EntityKey;
        file_path: FilePath;
    }
        >;

    /** Proposed changes from CODE-WRITE (already verified). */
    proposed: ProposedCodeChanges | null | undefined;

    /** Allowed surfaces (enforced again defensively). */
    allowed: {
        allowed_entity_keys: EntityKey[];
        allowed_file_paths: FilePath[];
        allowed_new_file_paths: FilePath[];
        max_files_to_touch: number;
    };

    body_store: CodeBodyStore;
    version_store: CodeVersionStore;
}): Promise<CodeAppendResult> {
    const {
        project_id,
        commit_run_id,
        base_files,
        entity_locators,
        proposed,
        allowed,
        body_store,
        version_store,
    } = args;

    if (!proposed) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_APPEND_UNUSABLE",
                    "Code append skipped: proposed changes are missing. Run CODE-WRITE and CODE-VERIFY first, then append the verified proposal."
                ),
            ],
            created_versions: [],
            skipped_unchanged_files: [],
        };
    }

    const baseByPath = new Map<FilePath, BaseFile>();
    for (const bf of base_files) baseByPath.set(bf.file_path, bf);

    const locatorByEntity = new Map<EntityKey, { file_path: FilePath; begin_sentinel: string; end_sentinel: string }>();
    for (const l of entity_locators) {
        locatorByEntity.set(l.entity_key, {
            file_path: l.file_path,
            begin_sentinel: l.begin_sentinel,
            end_sentinel: l.end_sentinel,
        });
    }

    // Defensive scope checks (CODE-VERIFY should already enforce these)
    const touchedFiles = new Set<FilePath>();
    for (const e of proposed.entity_edits) touchedFiles.add(e.file_path);
    for (const i of proposed.entity_inserts) touchedFiles.add(i.file_path);
    for (const nf of proposed.new_files) touchedFiles.add(nf.file_path);

    if (touchedFiles.size > allowed.max_files_to_touch) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_APPEND_UNUSABLE",
                    "Code append blocked: proposal touches too many files for this commit. Reduce scope to the allowed file count and retry."
                ),
            ],
            created_versions: [],
            skipped_unchanged_files: [],
        };
    }

    // Build new bodies per existing file
    const newBodies = new Map<FilePath, string>();

    // Seed with base bodies for files we will edit/insert into
    for (const fp of touchedFiles) {
        const isNew = proposed.new_files.some((n) => n.file_path === fp);
        if (isNew) continue;

        const base = baseByPath.get(fp);
        if (!base) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: missing base file body for "${fp}". Resolve context at the base run and include base file bodies before appending.`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }
        newBodies.set(fp, base.body);
    }

    // Apply entity edits
    for (const edit of proposed.entity_edits) {
        if (!allowed.allowed_entity_keys.includes(edit.entity_key)) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: edit target not allowed (${edit.entity_key}).`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }

        const loc = locatorByEntity.get(edit.entity_key);
        if (!loc || loc.file_path !== edit.file_path) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: missing locator for ${edit.entity_key} in ${edit.file_path}. Refresh index/entity locators and retry.`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }

        const cur = newBodies.get(edit.file_path);
        if (cur == null) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: no base body loaded for ${edit.file_path}.`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }

        const applied = applyEntityEdit({
            file_path: edit.file_path,
            body: cur,
            locator: { begin_sentinel: loc.begin_sentinel, end_sentinel: loc.end_sentinel },
            new_inner_code: edit.new_inner_code,
        });

        if (!applied.ok) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: could not apply entity edit. ${applied.reason}`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }

        newBodies.set(edit.file_path, applied.body);
    }

    // Apply entity inserts (append end)
    for (const ins of proposed.entity_inserts) {
        if (ins.insert_strategy !== "APPEND_END") {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        "Code append blocked: unsupported insert strategy. Only APPEND_END is allowed."
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }
        if (!allowed.allowed_file_paths.includes(ins.file_path)) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: insert file not allowed (${ins.file_path}).`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }

        const cur = newBodies.get(ins.file_path);
        if (cur == null) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: no base body loaded for ${ins.file_path}.`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }

        const applied = applyEntityInsert({
            file_path: ins.file_path,
            body: cur,
            entity_key: ins.entity_key,
            new_inner_code: ins.new_inner_code,
        });

        if (!applied.ok) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: could not insert entity. ${applied.reason}`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }

        newBodies.set(ins.file_path, applied.body);
    }

    // New files (full bodies)
    for (const nf of proposed.new_files) {
        if (!allowed.allowed_new_file_paths.includes(nf.file_path)) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "CODE_APPEND_UNUSABLE",
                        `Code append blocked: new file path not allowed (${nf.file_path}).`
                    ),
                ],
                created_versions: [],
                skipped_unchanged_files: [],
            };
        }
        const body = nf.body.endsWith("\n") ? nf.body : nf.body + "\n";
        newBodies.set(nf.file_path, body);
    }

    // Persist versions
    const created_versions: CodeFileVersion[] = [];
    const skipped_unchanged_files: FilePath[] = [];

    for (const [fp, body] of newBodies.entries()) {
        const newSha = sha256Hex(body);
        const newBytes = Buffer.byteLength(body, "utf8");

        const base = baseByPath.get(fp);
        if (base && base.body_sha256 === newSha) {
            skipped_unchanged_files.push(fp);
            continue;
        }

        const version_id: VersionId = uuid();
        const location = await body_store.putBody({
            project_id,
            run_id: commit_run_id,
            version_id,
            file_path: fp,
            body,
        });

        const v: CodeFileVersion = {
            version_id,
            project_id,
            file_path: fp,
            run_id: commit_run_id,
            is_deleted: false,
            body_location: location,
            body_sha256: newSha,
            body_bytes: newBytes,
            created_at: isoNow(),
        };

        await version_store.insertVersion(v);
        created_versions.push(v);
    }

    if (!created_versions.length && !skipped_unchanged_files.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "CODE_APPEND_UNUSABLE",
                    "Code append produced no file versions. Proposal may be empty or could not be applied. Ensure CODE-WRITE produced valid edits and base files were provided."
                ),
            ],
            created_versions: [],
            skipped_unchanged_files: [],
        };
    }

    return { ok: true, seals: [], created_versions, skipped_unchanged_files };
}
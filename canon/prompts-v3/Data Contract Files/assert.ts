/* Reverse Mechanics – minimal runtime assertions (no deps)
   Goal: fail fast on drift; keep runtime checks lean but integrity-first.
*/

import type {
    ContractVersion,
    RawChunk,
    Collectible,
    CollectiblesBundle,
    PromptCard,
    ProjectionCodebaseItem,
    ProjectionIssueItem,
    ProjectionIndexItem,
    ProjectionSlice,
    ContextEnvelope,
    SoftwareRun,
    SummaryEntry,
    ProjectionRef,
} from "./contracts";

function fail(msg: string): never {
    throw new Error(`ContractError: ${msg}`);
}

function isObject(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isString(x: unknown): x is string {
    return typeof x === "string";
}

function isNumber(x: unknown): x is number {
    return typeof x === "number" && Number.isFinite(x);
}

function isStringArray(x: unknown): x is string[] {
    return Array.isArray(x) && x.every(isString);
}

function assertContractVersion(x: unknown, path: string): asserts x is ContractVersion {
    if (!isString(x)) fail(`${path} must be string`);
    if (x !== "v1") fail(`${path} must be "v1"`);
}

/* =========================
   Raw chunks (worklog)
   ========================= */

export function assertRawChunk(x: unknown): asserts x is RawChunk {
    if (!isObject(x)) fail("RawChunk not an object");
    if (!isString(x.chunk_id) || x.chunk_id.length === 0) fail("RawChunk.chunk_id missing");
    if (x.kind !== "TEXT" && x.kind !== "CODE") fail("RawChunk.kind invalid");
    if (!isString(x.title)) fail("RawChunk.title missing");
    if (!isString(x.body)) fail("RawChunk.body missing");

    if (x.kind === "TEXT" && "link" in x) fail("RawChunk.TEXT must not have link");
    if (x.kind === "CODE" && "link" in x && !isString((x as any).link)) fail("RawChunk.CODE link must be string if present");
}

/**
 * Worklog invariants:
 * - max 18 chunks (policy; adjust if needed)
 * - unique chunk_id
 * - CODE chunks cannot be consecutive
 * - CODE chunk.link (if present) must reference a PREVIOUS TEXT chunk_id
 */
export function assertWorklogChunks(chunks: unknown): asserts chunks is RawChunk[] {
    if (!Array.isArray(chunks)) fail("Worklog.chunks must be array");
    if (chunks.length === 0) fail("Worklog.chunks empty");
    if (chunks.length > 18) fail("Worklog.chunks exceeds 18 (policy)");

    const seen = new Set<string>();
    const seenText = new Set<string>();
    let prevKind: "TEXT" | "CODE" | null = null;

    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        assertRawChunk(c);

        if (seen.has(c.chunk_id)) fail(`Worklog duplicate chunk_id: ${c.chunk_id}`);
        seen.add(c.chunk_id);

        if (c.kind === "CODE" && prevKind === "CODE") fail("Worklog has consecutive CODE chunks");

        if (c.kind === "TEXT") {
            seenText.add(c.chunk_id);
        } else {
            // CODE
            const link = (c as any).link as unknown;
            if (link !== undefined) {
                if (!isString(link) || link.length === 0) fail("CODE chunk.link must be non-empty string when present");
                if (!seenText.has(link)) fail(`CODE chunk.link must reference a previous TEXT chunk_id (got ${link})`);
            }
        }

        prevKind = c.kind;
    }
}

/* =========================
   Collectibles
   ========================= */

const K1_MAX_BODY = 700;
const FACET_MAX_BODY = 700;
const K2_MAX_BODY = 1200;

function assertBodyMax(body: string, max: number, path: string): void {
    if (body.length > max) fail(`${path} exceeds ${max} chars`);
}

function assertNoCodeFences(body: string, path: string): void {
    if (body.includes("```")) fail(`${path} must not contain code fences`);
}

export function assertCollectible(x: unknown): asserts x is Collectible {
    if (!isObject(x)) fail("Collectible not an object");

    if (!isString((x as any).id)) fail("Collectible.id missing");
    if (!isString((x as any).kind)) fail("Collectible.kind missing");
    if (!isString((x as any).title)) fail("Collectible.title missing");
    if (!isString((x as any).body)) fail("Collectible.body missing");
    if (!Array.isArray((x as any).sources) || !(x as any).sources.every(isString)) fail("Collectible.sources invalid");
    if ((x as any).sources.length === 0) fail("Collectible.sources must be non-empty");

    const id = (x as any).id as string;
    const kind = (x as any).kind as string;
    const body = (x as any).body as string;

    if (id === "K1") {
        if (kind !== "KEYSTONE_TEXT") fail("K1 kind must be KEYSTONE_TEXT");
        const kt = (x as any).keystone_type;
        const allowed = ["LAW", "MODEL", "MAP", "WAGER", "IDOL", "SPELL"];
        if (!allowed.includes(kt)) fail("K1.keystone_type invalid");
        assertBodyMax(body, K1_MAX_BODY, "K1.body");
    } else if (id === "K2") {
        if (kind !== "KEYSTONE_CODE") fail("K2 kind must be KEYSTONE_CODE");
        assertBodyMax(body, K2_MAX_BODY, "K2.body");
    } else if (id === "F1") {
        if (kind !== "FACET") fail("F1 kind must be FACET");
        if ((x as any).facet_type !== "ANCHOR") fail("F1 facet_type must be ANCHOR");
        assertBodyMax(body, FACET_MAX_BODY, "F1.body");
        assertNoCodeFences(body, "F1.body");
    } else if (id === "F2") {
        if (kind !== "FACET") fail("F2 kind must be FACET");
        if ((x as any).facet_type !== "PROOF") fail("F2 facet_type must be PROOF");
        assertBodyMax(body, FACET_MAX_BODY, "F2.body");
        assertNoCodeFences(body, "F2.body");
    } else if (id === "P1") {
        if (kind !== "FACET") fail("P1 kind must be FACET");
        if ((x as any).facet_type !== "PROGRESS") fail("P1 facet_type must be PROGRESS");
        assertBodyMax(body, FACET_MAX_BODY, "P1.body");
        assertNoCodeFences(body, "P1.body");
    } else {
        fail("Unknown Collectible.id");
    }
}

/**
 * Bundle invariants (gate that prevents collectible drift):
 * - contract_version required
 * - K1 required and must be first
 * - max one of each: K2, F1, F2, P1
 * - total 1..5
 */
export function assertCollectiblesBundle(x: unknown): asserts x is CollectiblesBundle {
    if (!isObject(x)) fail("CollectiblesBundle not an object");

    assertContractVersion((x as any).contract_version, "CollectiblesBundle.contract_version");

    if (!isString((x as any).action_id)) fail("CollectiblesBundle.action_id missing");
    if (!Array.isArray((x as any).collectibles)) fail("CollectiblesBundle.collectibles missing");

    const arr = (x as any).collectibles as unknown[];
    if (arr.length < 1 || arr.length > 5) fail("CollectiblesBundle.collectibles length must be 1..5");

    if (!isObject(arr[0]) || (arr[0] as any).id !== "K1") fail("CollectiblesBundle: first collectible must be K1");

    const counts: Record<string, number> = { K1: 0, K2: 0, F1: 0, F2: 0, P1: 0 };
    for (const c of arr) {
        assertCollectible(c);
        const id = (c as any).id as keyof typeof counts;
        if (id in counts) counts[id]++;
    }

    if (counts.K1 !== 1) fail("CollectiblesBundle must contain exactly one K1");
    if (counts.K2 > 1) fail("CollectiblesBundle must contain at most one K2");
    if (counts.F1 > 1) fail("CollectiblesBundle must contain at most one F1");
    if (counts.F2 > 1) fail("CollectiblesBundle must contain at most one F2");
    if (counts.P1 > 1) fail("CollectiblesBundle must contain at most one P1");
}

/**
 * Optional grounding gate (call when you have the raw chunks for this run):
 * - every sources[] entry must exist in raw_chunks
 * - if a collectible sources a CODE chunk that has link -> linked TEXT chunk must also be sourced
 */
export function assertCollectiblesBundleAgainstChunks(input: {
    bundle: unknown;
    raw_chunks: unknown;
}): void {
    assertCollectiblesBundle(input.bundle);
    assertWorklogChunks(input.raw_chunks);

    const chunks = input.raw_chunks as RawChunk[];
    const byId = new Map<string, RawChunk>();
    for (const c of chunks) byId.set(c.chunk_id, c);

    const collectibles = (input.bundle as CollectiblesBundle).collectibles;
    for (const col of collectibles) {
        for (const s of col.sources) {
            if (!byId.has(s)) fail(`Collectible source chunk_id not found: ${s}`);
        }

        // Link contract: if a sourced chunk is CODE with a link, the linked TEXT must also be in sources.
        for (const s of col.sources) {
            const c = byId.get(s)!;
            if (c.kind === "CODE" && c.link) {
                if (!col.sources.includes(c.link)) {
                    fail(
                        `Collectible must include linked framing TEXT chunk_id (${c.link}) when sourcing CODE chunk (${c.chunk_id})`
                    );
                }
            }
        }
    }
}

/* =========================
   Prompt cards
   ========================= */

function projectionRefKey(r: ProjectionRef): string {
    return r.ns === "CODEBASE" ? `C:${r.entity_key}` : `I:${r.issue_key}`;
}

function projectionRefSortKey(r: ProjectionRef): string {
    const nsRank = r.ns === "CODEBASE" ? "0" : "1";
    const key = r.ns === "CODEBASE" ? r.entity_key : r.issue_key;
    return `${nsRank}|${key}`;
}

function isCanonicalProjectionRefs(refs: ProjectionRef[]): boolean {
    // Deduped + sorted by projectionRefSortKey.
    const seen = new Set<string>();
    for (const r of refs) {
        const k = projectionRefKey(r);
        if (seen.has(k)) return false;
        seen.add(k);
    }
    for (let i = 1; i < refs.length; i++) {
        const a = projectionRefSortKey(refs[i - 1]);
        const b = projectionRefSortKey(refs[i]);
        if (a > b) return false;
    }
    return true;
}

export function assertPromptCard(x: unknown): asserts x is PromptCard {
    if (!isObject(x)) fail("PromptCard not an object");

    assertContractVersion((x as any).contract_version, "PromptCard.contract_version");

    for (const k of ["prompt_card_id", "title", "sanitized_intent", "bound_action_id", "fingerprint"] as const) {
        if (!isString((x as any)[k])) fail(`PromptCard.${k} missing`);
    }

    if (!Array.isArray((x as any).bound_target_ids) || !(x as any).bound_target_ids.every(isString)) {
        fail("PromptCard.bound_target_ids invalid");
    }

    if ("bound_milestone_id" in x && (x as any).bound_milestone_id !== undefined && !isString((x as any).bound_milestone_id)) {
        fail("PromptCard.bound_milestone_id invalid");
    }

    if (!Array.isArray((x as any).selected_projection_refs)) fail("PromptCard.selected_projection_refs invalid");

    for (const r of (x as any).selected_projection_refs) {
        if (!isObject(r)) fail("ProjectionRef not object");
        if ((r as any).ns === "CODEBASE") {
            if (!isString((r as any).entity_key) || (r as any).entity_key.length === 0) fail("ProjectionRef.CODEBASE.entity_key missing");
        } else if ((r as any).ns === "ISSUE") {
            if (!isString((r as any).issue_key) || (r as any).issue_key.length === 0) fail("ProjectionRef.ISSUE.issue_key missing");
        } else {
            fail("ProjectionRef.ns invalid");
        }
    }

    if (!isNumber((x as any).slice_version) || !Number.isInteger((x as any).slice_version) || (x as any).slice_version < 1) {
        fail("PromptCard.slice_version must be integer >= 1");
    }

    if (!isCanonicalProjectionRefs((x as any).selected_projection_refs)) {
        fail("PromptCard.selected_projection_refs must be deduped and in canonical order (CODEBASE first; stable sort)");
    }
}

/* =========================
   Projections
   ========================= */

export function assertProjectionCodebaseItem(x: unknown): asserts x is ProjectionCodebaseItem {
    if (!isObject(x)) fail("ProjectionCodebaseItem not object");

    for (const k of ["entity_key", "file_path", "symbol", "kind", "language", "summary", "status", "updated_at_run_id"] as const) {
        if (!isString((x as any)[k]) || (x as any)[k].length === 0) fail(`ProjectionCodebaseItem.${k} missing`);
    }

    const kind = (x as any).kind;
    const allowedKinds = ["FUNCTION", "CLASS", "COMPONENT", "TYPE", "CONFIG", "FILE"];
    if (!allowedKinds.includes(kind)) fail("ProjectionCodebaseItem.kind invalid");

    const filePath = (x as any).file_path as string;
    const entityKey = (x as any).entity_key as string;
    if (!entityKey.includes("::")) fail("ProjectionCodebaseItem.entity_key must contain '::'");
    if (!entityKey.startsWith(filePath + "::")) fail("ProjectionCodebaseItem.entity_key must start with file_path + '::'");

    const status = (x as any).status;
    if (status !== "ACTIVE" && status !== "REMOVED") fail("ProjectionCodebaseItem.status invalid");

    if (status === "ACTIVE") {
        if (!isString((x as any).body) || (x as any).body.length === 0) fail("ProjectionCodebaseItem.ACTIVE.body missing");
        if ("replaced_by" in x) fail("ProjectionCodebaseItem.ACTIVE must not have replaced_by");
    } else {
        // REMOVED tombstone
        if ("body" in x) fail("ProjectionCodebaseItem.REMOVED must not have body");
        if ("replaced_by" in x && (x as any).replaced_by !== undefined && !isString((x as any).replaced_by)) {
            fail("ProjectionCodebaseItem.REMOVED.replaced_by invalid");
        }
    }
}

export function assertProjectionIndexItem(x: unknown): asserts x is ProjectionIndexItem {
    if (!isObject(x)) fail("ProjectionIndexItem not object");

    for (const k of ["file_path", "updated_at_run_id", "file_summary"] as const) {
        if (!isString((x as any)[k]) || (x as any)[k].length === 0) fail(`ProjectionIndexItem.${k} missing`);
    }
    if (!isStringArray((x as any).contains_entity_keys)) fail("ProjectionIndexItem.contains_entity_keys invalid");
}

export function assertProjectionIssueItem(x: unknown): asserts x is ProjectionIssueItem {
    if (!isObject(x)) fail("ProjectionIssueItem not object");

    for (const k of ["issue_key", "title", "status", "updated_at_run_id"] as const) {
        if (!isString((x as any)[k]) || (x as any)[k].length === 0) fail(`ProjectionIssueItem.${k} missing`);
    }

    const st = (x as any).status;
    if (st !== "OPEN" && st !== "CLOSED") fail("ProjectionIssueItem.status invalid");

    if ("severity" in x && (x as any).severity !== undefined) {
        const sev = (x as any).severity;
        if (sev !== "LOW" && sev !== "MED" && sev !== "HIGH") fail("ProjectionIssueItem.severity invalid");
    }

    const hasEntity = "anchor_entity_key" in x && (x as any).anchor_entity_key !== undefined;
    const hasFile = "anchor_file_path" in x && (x as any).anchor_file_path !== undefined;

    if (!hasEntity && !hasFile) fail("ProjectionIssueItem must have at least one anchor (anchor_entity_key or anchor_file_path)");

    if (hasEntity && !isString((x as any).anchor_entity_key)) fail("ProjectionIssueItem.anchor_entity_key invalid");
    if (hasFile && !isString((x as any).anchor_file_path)) fail("ProjectionIssueItem.anchor_file_path invalid");
}

export function assertProjectionSlice(x: unknown): asserts x is ProjectionSlice {
    if (!isObject(x)) fail("ProjectionSlice not object");
    if (!Array.isArray((x as any).codebase)) fail("ProjectionSlice.codebase invalid");
    if (!Array.isArray((x as any).issues)) fail("ProjectionSlice.issues invalid");

    for (const c of (x as any).codebase) assertProjectionCodebaseItem(c);
    for (const i of (x as any).issues) assertProjectionIssueItem(i);
}

/* =========================
   Context envelope
   ========================= */

export function assertSummaryEntry(x: unknown): asserts x is SummaryEntry {
    if (!isObject(x)) fail("SummaryEntry not object");
    if (!isString((x as any).summary_id)) fail("SummaryEntry.summary_id missing");
    const scope = (x as any).scope;
    if (scope !== "GLOBAL" && scope !== "MILESTONE") fail("SummaryEntry.scope invalid");

    if (scope === "MILESTONE") {
        if (!isString((x as any).milestone_id)) fail("SummaryEntry.milestone_id required when scope=MILESTONE");
    } else {
        if ("milestone_id" in x && (x as any).milestone_id !== undefined && !isString((x as any).milestone_id)) {
            fail("SummaryEntry.milestone_id invalid");
        }
    }

    if ("run_id" in x && (x as any).run_id !== undefined && !isString((x as any).run_id)) fail("SummaryEntry.run_id invalid");
    if (!isString((x as any).text)) fail("SummaryEntry.text missing");
}

export function assertSoftwareRun(x: unknown): asserts x is SoftwareRun {
    if (!isObject(x)) fail("SoftwareRun not object");
    if (!isString((x as any).run_id)) fail("SoftwareRun.run_id missing");
    if (!isString((x as any).action_id)) fail("SoftwareRun.action_id missing");
    if ("milestone_id" in x && (x as any).milestone_id !== undefined && !isString((x as any).milestone_id)) {
        fail("SoftwareRun.milestone_id invalid");
    }
    assertWorklogChunks((x as any).chunks);
}

export function assertContextEnvelope(x: unknown): asserts x is ContextEnvelope {
    if (!isObject(x)) fail("ContextEnvelope not object");

    assertContractVersion((x as any).contract_version, "ContextEnvelope.contract_version");

    if (!Array.isArray((x as any).summaries)) fail("ContextEnvelope.summaries invalid");
    for (const s of (x as any).summaries) assertSummaryEntry(s);

    if (!Array.isArray((x as any).recent_runs)) fail("ContextEnvelope.recent_runs invalid");
    if ((x as any).recent_runs.length > 2) fail("ContextEnvelope.recent_runs must be <= 2 (policy)");
    for (const r of (x as any).recent_runs) assertSoftwareRun(r);
}

/* projection_patch.v1.ts
   Canon ProjectionPatch contract + ops (v1).
   Minimal, discriminated union + runtime assertions.
*/

export type ContractVersionV1 = "v1";

export type CodebaseStatus = "ACTIVE" | "REMOVED";

export type CodebaseKind =
    | "FILE"
    | "MODULE"
    | "IMPORTS"
    | "EXPORTS"
    | "TYPE"
    | "INTERFACE"
    | "CLASS"
    | "FUNCTION"
    | "CONST"
    | "HOOK"
    | "COMPONENT"
    | "ROUTE"
    | "MIDDLEWARE"
    | "UTIL"
    | "OTHER";

export type IssueStatus = "OPEN" | "BLOCKED" | "INFO" | "CLOSED";
export type IssueSeverity = "LOW" | "MED" | "HIGH";

export type ProjectionOpType =
    | "UPSERT_CODEBASE"
    | "MARK_REMOVED_CODEBASE"
    | "UPSERT_INDEX"
    | "DELETE_INDEX"
    | "UPSERT_ISSUE"
    | "CLOSE_ISSUE"
    | "LINK_ISSUE";

export type BaseOpV1 = {
    type: ProjectionOpType;
    updated_at_run_id: string;
};

export type UpsertCodebaseOpV1 = BaseOpV1 & {
    type: "UPSERT_CODEBASE";
    entity_key: string;
    file_path: string;
    kind: CodebaseKind;
    status: "ACTIVE";
    summary: string; // 1-line, specific
    body: string; // code text
};

export type MarkRemovedCodebaseOpV1 = BaseOpV1 & {
    type: "MARK_REMOVED_CODEBASE";
    entity_key: string;
    replaced_by?: string; // entity_key
    removed_body_ref?: string; // pointer to archived old body blob (optional)
};

export type UpsertIndexOpV1 = BaseOpV1 & {
    type: "UPSERT_INDEX";
    file_path: string;
    file_summary: string; // 1-line, specific
    contains_entity_keys: string[]; // ideally authoritative list for ACTIVE entities in file
};

export type DeleteIndexOpV1 = BaseOpV1 & {
    type: "DELETE_INDEX";
    file_path: string;
};

export type UpsertIssueOpV1 = BaseOpV1 & {
    type: "UPSERT_ISSUE";
    issue_key: string;
    title: string;
    status: IssueStatus;
    // At least one anchor required:
    anchor_entity_key?: string;
    anchor_file_path?: string;
    details?: string; // short
    severity?: IssueSeverity;
};

export type CloseIssueOpV1 = BaseOpV1 & {
    type: "CLOSE_ISSUE";
    issue_key: string;
    resolution_note?: string; // short
};

export type LinkIssueOpV1 = BaseOpV1 & {
    type: "LINK_ISSUE";
    issue_key: string;
    // exactly one of these should be provided (enforced by validator below):
    related_issue_key?: string;
    related_entity_key?: string;
    related_run_id?: string;
    related_milestone_id?: string;
    note?: string; // short
};

export type ProjectionOpV1 =
    | UpsertCodebaseOpV1
    | MarkRemovedCodebaseOpV1
    | UpsertIndexOpV1
    | DeleteIndexOpV1
    | UpsertIssueOpV1
    | CloseIssueOpV1
    | LinkIssueOpV1;

export type ProjectionPatchV1 = {
    contract_version: ContractVersionV1;
    run_id: string;
    ops: ProjectionOpV1[];
};

/* ---------------- Runtime validation ---------------- */

function fail(msg: string): never {
    throw new Error(`ProjectionPatchV1: ${msg}`);
}

function isObj(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isStr(x: unknown): x is string {
    return typeof x === "string" && x.trim().length > 0;
}

function isStrArr(x: unknown): x is string[] {
    return Array.isArray(x) && x.every(isStr);
}

function oneLineish(s: string): boolean {
    // allow a single newline at most? keep it strict:
    return !s.includes("\n") && s.length <= 240;
}

function countTruthy(obj: Record<string, unknown>, keys: string[]): number {
    return keys.reduce((n, k) => (obj[k] ? n + 1 : n), 0);
}

export function assertProjectionPatchV1(x: unknown): asserts x is ProjectionPatchV1 {
    if (!isObj(x)) fail("not an object");
    if (x.contract_version !== "v1") fail("contract_version must be 'v1'");
    if (!isStr(x.run_id)) fail("run_id missing/invalid");
    if (!Array.isArray(x.ops)) fail("ops must be an array");

    x.ops.forEach((op, i) => assertProjectionOpV1(op, `ops[${i}]`));
}

export function assertProjectionOpV1(op: unknown, path = "op"): asserts op is ProjectionOpV1 {
    if (!isObj(op)) fail(`${path} not an object`);
    if (!isStr(op.type)) fail(`${path}.type missing/invalid`);
    if (!isStr(op.updated_at_run_id)) fail(`${path}.updated_at_run_id missing/invalid`);

    switch (op.type) {
        case "UPSERT_CODEBASE": {
            if (!isStr(op.entity_key)) fail(`${path}.entity_key missing/invalid`);
            if (!isStr(op.file_path)) fail(`${path}.file_path missing/invalid`);
            if (!isStr(op.kind)) fail(`${path}.kind missing/invalid`);
            if (op.status !== "ACTIVE") fail(`${path}.status must be ACTIVE`);
            if (!isStr(op.summary) || !oneLineish(op.summary)) fail(`${path}.summary missing/too long/not 1-line`);
            if (!isStr(op.body)) fail(`${path}.body missing/invalid`);
            return;
        }

        case "MARK_REMOVED_CODEBASE": {
            if (!isStr(op.entity_key)) fail(`${path}.entity_key missing/invalid`);
            if (op.replaced_by !== undefined && !isStr(op.replaced_by)) fail(`${path}.replaced_by invalid`);
            if (op.removed_body_ref !== undefined && !isStr(op.removed_body_ref)) fail(`${path}.removed_body_ref invalid`);
            return;
        }

        case "UPSERT_INDEX": {
            if (!isStr(op.file_path)) fail(`${path}.file_path missing/invalid`);
            if (!isStr(op.file_summary) || !oneLineish(op.file_summary)) fail(`${path}.file_summary missing/too long/not 1-line`);
            if (!isStrArr(op.contains_entity_keys)) fail(`${path}.contains_entity_keys missing/invalid`);
            // Allow empty list, but usually indicates file has no tracked entities:
            // if (op.contains_entity_keys.length === 0) fail(`${path}.contains_entity_keys must not be empty`);
            return;
        }

        case "DELETE_INDEX": {
            if (!isStr(op.file_path)) fail(`${path}.file_path missing/invalid`);
            return;
        }

        case "UPSERT_ISSUE": {
            if (!isStr(op.issue_key)) fail(`${path}.issue_key missing/invalid`);
            if (!isStr(op.title)) fail(`${path}.title missing/invalid`);
            if (!isStr(op.status)) fail(`${path}.status missing/invalid`);
            const anchors = countTruthy(op, ["anchor_entity_key", "anchor_file_path"]);
            if (anchors < 1) fail(`${path} must include anchor_entity_key or anchor_file_path`);
            if (op.anchor_entity_key !== undefined && !isStr(op.anchor_entity_key)) fail(`${path}.anchor_entity_key invalid`);
            if (op.anchor_file_path !== undefined && !isStr(op.anchor_file_path)) fail(`${path}.anchor_file_path invalid`);
            if (op.details !== undefined && !isStr(op.details)) fail(`${path}.details invalid`);
            if (op.severity !== undefined && !isStr(op.severity)) fail(`${path}.severity invalid`);
            return;
        }

        case "CLOSE_ISSUE": {
            if (!isStr(op.issue_key)) fail(`${path}.issue_key missing/invalid`);
            if (op.resolution_note !== undefined && !isStr(op.resolution_note)) fail(`${path}.resolution_note invalid`);
            return;
        }

        case "LINK_ISSUE": {
            if (!isStr(op.issue_key)) fail(`${path}.issue_key missing/invalid`);
            const relatedCount = countTruthy(op, [
                "related_issue_key",
                "related_entity_key",
                "related_run_id",
                "related_milestone_id",
            ]);
            if (relatedCount !== 1) fail(`${path} must include exactly one related_* field`);
            if (op.related_issue_key !== undefined && !isStr(op.related_issue_key)) fail(`${path}.related_issue_key invalid`);
            if (op.related_entity_key !== undefined && !isStr(op.related_entity_key)) fail(`${path}.related_entity_key invalid`);
            if (op.related_run_id !== undefined && !isStr(op.related_run_id)) fail(`${path}.related_run_id invalid`);
            if (op.related_milestone_id !== undefined && !isStr(op.related_milestone_id)) fail(`${path}.related_milestone_id invalid`);
            if (op.note !== undefined && !isStr(op.note)) fail(`${path}.note invalid`);
            return;
        }

        default:
            fail(`${path}.type unknown: ${(op as any).type}`);
    }
}

/* Reverse Mechanics – projection CRUD ops (declarative updates) */

import type {
    ContractVersion,
    ProjectionCodebaseItem,
    ProjectionIndexItem,
    ProjectionIssueItem,
    RunId,
} from "./contracts";

export type ProjectionOp =
    | { op: "UPSERT_CODEBASE"; item: ProjectionCodebaseItem }
    | { op: "MARK_REMOVED_CODEBASE"; entity_key: string; updated_at_run_id: RunId; replaced_by?: string }
    | { op: "UPSERT_INDEX"; item: ProjectionIndexItem }
    | { op: "UPSERT_ISSUE"; item: ProjectionIssueItem }
    | { op: "CLOSE_ISSUE"; issue_key: string; updated_at_run_id: RunId };

export interface ProjectionPatch {
    contract_version: ContractVersion;
    run_id: RunId;
    ops: ProjectionOp[];
}

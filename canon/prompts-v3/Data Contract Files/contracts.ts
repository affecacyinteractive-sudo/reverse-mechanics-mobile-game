/* Reverse Mechanics – minimal contracts (no external schema libs)
   Principle: lean without integrity loss.
*/

export type RunId = string;
export type ActionId = string;
export type TargetId = string;
export type MilestoneId = string;
export type PromptCardId = string;

export type ContractVersion = "v1";

export type ChunkId = string; // e.g., "W1", "W2", ...
export type ChunkKind = "TEXT" | "CODE";

export interface RawChunk {
    chunk_id: ChunkId;
    kind: ChunkKind;
    title: string;
    body: string;
    // Only for CODE chunks; should be absent for TEXT.
    link?: string;
}

/** Collectibles (premium reward surface) */
export type KeystoneType = "LAW" | "MODEL" | "MAP" | "WAGER" | "IDOL" | "SPELL";
export type FacetType = "ANCHOR" | "PROOF" | "PROGRESS";

/** KeystoneType meanings (presentation + retrieval metadata; not required for orchestration)
 * LAW   : constraint / allowed vs forbidden rule + consequence
 * MODEL : mechanism explanation (inputs -> transform -> outputs)
 * MAP   : structured view of parts + boundaries
 * WAGER : milestone-like bet with "done receipt"
 * IDOL  : named entity with powers/limits (rare in software)
 * SPELL : repeatable procedure (preconditions -> move -> aftermath)
 */

/** FacetType meanings
 * ANCHOR   : where/what the keystone applies to (scope/placement)
 * PROOF    : minimal evidence the keystone is safe to canonize
 * PROGRESS : milestone comparison (movement + gap)
 */

export interface KeystoneTextCollectible {
    id: "K1";
    kind: "KEYSTONE_TEXT";
    keystone_type: KeystoneType;
    title: string;
    body: string;
    sources: ChunkId[];
}

export interface KeystoneCodeCollectible {
    id: "K2";
    kind: "KEYSTONE_CODE";
    title: string;
    body: string;
    sources: ChunkId[];
}

/** Facet id ↔ facet_type mapping is encoded at the type level. */
export interface AnchorFacetCollectible {
    id: "F1";
    kind: "FACET";
    facet_type: "ANCHOR";
    title: string;
    body: string;
    sources: ChunkId[];
}

export interface ProofFacetCollectible {
    id: "F2";
    kind: "FACET";
    facet_type: "PROOF";
    title: string;
    body: string;
    sources: ChunkId[];
}

export interface ProgressFacetCollectible {
    id: "P1";
    kind: "FACET";
    facet_type: "PROGRESS";
    title: string;
    body: string;
    sources: ChunkId[];
}

export type FacetCollectible = AnchorFacetCollectible | ProofFacetCollectible | ProgressFacetCollectible;

export type Collectible = KeystoneTextCollectible | KeystoneCodeCollectible | FacetCollectible;

export interface CollectiblesBundle {
    contract_version: ContractVersion;
    action_id: ActionId;
    collectibles: Collectible[];
}

/** Summaries + last 1–2 runs of raw chunks are the default "descriptive" memory */
export type SummaryScope = "GLOBAL" | "MILESTONE";

export interface SummaryEntry {
    summary_id: string; // e.g., "S-2026-01-24-01"
    scope: SummaryScope;
    // milestone_id must exist when scope==="MILESTONE"
    milestone_id?: MilestoneId;
    // optional: if this summary corresponds to a specific run
    run_id?: RunId;
    text: string; // <summary>...</summary> inner text
}

export interface SoftwareRun {
    run_id: RunId;
    action_id: ActionId;
    milestone_id?: MilestoneId;
    chunks: RawChunk[];
}

export interface ContextEnvelope {
    contract_version: ContractVersion;
    summaries: SummaryEntry[];
    // Only last 1–2 runs should be present here by policy.
    recent_runs: SoftwareRun[];
}

/** Prompt Cards bind intent + loadout + projection slice */
export type ProjectionNamespace = "CODEBASE" | "ISSUE";

export type ProjectionRef =
    | { ns: "CODEBASE"; entity_key: string }
    | { ns: "ISSUE"; issue_key: string };

export interface PromptCard {
    contract_version: ContractVersion;
    prompt_card_id: PromptCardId;
    title: string;
    sanitized_intent: string;

    bound_action_id: ActionId;
    bound_target_ids: TargetId[];
    bound_milestone_id?: MilestoneId;

    // Deterministic fingerprint to detect mismatch.
    fingerprint: string;

    // Option B: Prompt Card stores the preselected slice refs (canonical order; deduped).
    selected_projection_refs: ProjectionRef[];
    slice_version: number;
}

/** Projections (authoritative current truth) */
export type CodeEntityKind = "FUNCTION" | "CLASS" | "COMPONENT" | "TYPE" | "CONFIG" | "FILE";
export type ProjectionStatus = "ACTIVE" | "REMOVED";

export interface ProjectionCodebaseBase {
    entity_key: string; // file_path::symbol
    file_path: string;
    symbol: string; // name or "FILE"
    kind: CodeEntityKind;
    language: string; // e.g., "ts", "tsx", "js", "json"
    summary: string; // 1 line, required for reliable INDEX lookup
    updated_at_run_id: RunId;
}

export interface ProjectionCodebaseActiveItem extends ProjectionCodebaseBase {
    status: "ACTIVE";
    body: string; // bounded shard, latest truth
}

export interface ProjectionCodebaseRemovedItem extends ProjectionCodebaseBase {
    status: "REMOVED";
    replaced_by?: string; // entity_key of replacement, if any
    // No body for tombstones.
}

export type ProjectionCodebaseItem = ProjectionCodebaseActiveItem | ProjectionCodebaseRemovedItem;

export interface ProjectionIndexItem {
    file_path: string;
    contains_entity_keys: string[];
    file_summary: string; // required for reliable INDEX lookup
    updated_at_run_id: RunId;
}

export type IssueStatus = "OPEN" | "CLOSED";
export type IssueSeverity = "LOW" | "MED" | "HIGH";

export interface ProjectionIssueBase {
    issue_key: string;
    title: string; // 1 line symptom
    status: IssueStatus;
    severity?: IssueSeverity;
    updated_at_run_id: RunId;
}

export interface ProjectionIssueAnchoredToEntity extends ProjectionIssueBase {
    anchor_entity_key: string;
    anchor_file_path?: string;
}

export interface ProjectionIssueAnchoredToFile extends ProjectionIssueBase {
    anchor_file_path: string;
    anchor_entity_key?: string;
}

export type ProjectionIssueItem = ProjectionIssueAnchoredToEntity | ProjectionIssueAnchoredToFile;

export interface ProjectionSlice {
    // Only the small mounted subset needed for a call.
    codebase: ProjectionCodebaseItem[];
    issues: ProjectionIssueItem[];
}

/** Seals (event log) */
export type SealLevel = "INFO" | "WARN" | "FAIL" | "PASS";

export interface Seal {
    seal_id: string;
    run_id: RunId;
    step_id: string; // e.g., "R1_SCOPE_GATE", "R3_WORKLOG"
    level: SealLevel;
    message: string; // tiny
    created_at_unix_ms: number;
}

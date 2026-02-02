// milestone_family.types.ts

export type ContractVersion = "v1";

export type MilestoneFreshness = "FRESH" | "STALE";

/**
 * "Family" = a chain of enrichments for one logical milestone pursuit.
 * V1 invariant: at most one family is ACTIVE in the whole project state.
 */
export type MilestoneFamilyStatus = "ACTIVE" | "ARCHIVED"; // (archived covers stale relic families)

export type MilestoneFamilyId = string;
export type MilestoneId = string;
export type RunId = string;
export type PromptCardId = string;

/**
 * Anchor refs are projection INDEX item IDs (recommended v1).
 * V1: used for inspection/debug only, not for staleness math.
 */
export type ProjectionIndexId = string;


// milestone_family.types.ts (continued)

export interface ActiveFamilyPointerV1 {
    contract_version: ContractVersion;

    /**
     * The only family allowed to be ACTIVE at a time.
     */
    active_family_id: MilestoneFamilyId;

    /**
     * The milestone the UI treats as "current milestone" (what R3 chases).
     * In your design: always the latest head of the family.
     */
    active_head_milestone_id: MilestoneId;

    /**
     * Run that last set / updated the active pointer.
     */
    updated_at_run_id: RunId;
}


// milestone_family.types.ts (continued)

export interface MilestoneAnchorsV1 {
    anchor_basis_run_id: RunId;
    anchor_projection_refs: ProjectionIndexId[];
}

/**
 * Minimal lineage linking:
 * - family_id groups all enrichments
 * - parent_milestone_id links to previous version in the family chain
 * - head = latest version (the one used for R3 if family is active)
 */
export interface MilestoneFamilyLinkV1 {
    family_id: MilestoneFamilyId;

    /**
     * Null/undefined means this is the family root (first created milestone).
     * Enriched milestones set parent_milestone_id to the prior head.
     */
    parent_milestone_id?: MilestoneId;

    /**
     * True for the newest milestone in the family chain.
     * V1 invariant: only one head per family.
     */
    is_family_head: boolean;

    /**
     * Family status is stored on milestone as well to make querying easy.
     * V1: ACTIVE family has exactly one head milestone which is FRESH.
     */
    family_status: MilestoneFamilyStatus;
}

/**
 * Milestone artifact as used by gameplay.
 * You can keep your existing field schema; this focuses on family + freshness.
 */
export interface MilestoneArtifactV1 {
    contract_version: ContractVersion;
    artifact_type: "MILESTONE";

    milestone_id: MilestoneId;

    /**
     * V1: Only milestones in the ACTIVE family can be FRESH.
     * Everything else is STALE (read-only).
     */
    freshness: MilestoneFreshness;

    // 4 primary milestone fields (keep your existing exact names if different)
    north_star: string;
    scope_fence: string;
    tripwires: string;
    done_receipt: string;

    // provenance: "bounded inputs that created it"
    created_from_prompt_card_id: PromptCardId;
    created_at_run_id: RunId;
    updated_at_run_id?: RunId;

    // family lineage
    family: MilestoneFamilyLinkV1;

    // optional inspection anchors
    anchors?: MilestoneAnchorsV1;
}

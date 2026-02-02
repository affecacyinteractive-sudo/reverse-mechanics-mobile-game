// contract.ts (patch example)

import type { MilestoneFreshness, ProjectionIndexId } from "./types/milestoneFreshness";

export type MilestoneId = string;
export type RunId = string;
export type PromptCardId = string;

export interface MilestoneAnchorV1 {
    /**
     * Projection INDEX item IDs that were relevant at time of creation/enrichment.
     * V1 purpose: display/debug only (not used for staleness calculation).
     */
    anchor_projection_refs: ProjectionIndexId[];

    /**
     * Run that wrote these anchors (useful for inspection/debug).
     * Not required for v1 freshness logic.
     */
    anchor_basis_run_id: RunId;
}

export interface MilestoneArtifactV1 {
    contract_version: "v1";
    artifact_type: "MILESTONE";

    milestone_id: MilestoneId;

    /**
     * V1: FRESH = current active milestone; STALE = everything else.
     */
    freshness: MilestoneFreshness;

    /**
     * Standard milestone fields (you already have these conceptually).
     * Keep your existing shape; this is just placeholder.
     */
    north_star: string;
    scope_fence: string;
    tripwires: string;
    done_receipt: string;

    /**
     * Provenance (this is what makes stale milestones useful as passive resources).
     */
    created_from_prompt_card_id: PromptCardId;
    created_at_run_id: RunId;

    /**
     * Optional: if milestone was enriched, track last update.
     */
    updated_at_run_id?: RunId;

    /**
     * Anchors for “what code areas were involved.”
     */
    anchors: MilestoneAnchorV1;
}

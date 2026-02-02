// assert.ts (patch example)

import type { MilestoneArtifactV1 } from "./contract";

function isNonEmptyString(x: unknown): x is string {
    return typeof x === "string" && x.trim().length > 0;
}

function isStringArray(x: unknown): x is string[] {
    return Array.isArray(x) && x.every((v) => typeof v === "string");
}

export function assertMilestoneArtifactV1(x: unknown): asserts x is MilestoneArtifactV1 {
    const m = x as MilestoneArtifactV1;

    if (!m || typeof m !== "object") throw new Error("MilestoneArtifactV1: not an object");

    if (m.contract_version !== "v1") throw new Error("MilestoneArtifactV1: contract_version must be v1");
    if (m.artifact_type !== "MILESTONE") throw new Error("MilestoneArtifactV1: artifact_type must be MILESTONE");

    if (!isNonEmptyString(m.milestone_id)) throw new Error("MilestoneArtifactV1: milestone_id required");

    if (m.freshness !== "FRESH" && m.freshness !== "STALE") {
        throw new Error("MilestoneArtifactV1: freshness must be FRESH|STALE");
    }

    if (!isNonEmptyString(m.north_star)) throw new Error("MilestoneArtifactV1: north_star required");
    if (!isNonEmptyString(m.scope_fence)) throw new Error("MilestoneArtifactV1: scope_fence required");
    if (!isNonEmptyString(m.tripwires)) throw new Error("MilestoneArtifactV1: tripwires required");
    if (!isNonEmptyString(m.done_receipt)) throw new Error("MilestoneArtifactV1: done_receipt required");

    if (!isNonEmptyString(m.created_from_prompt_card_id)) {
        throw new Error("MilestoneArtifactV1: created_from_prompt_card_id required");
    }
    if (!isNonEmptyString(m.created_at_run_id)) throw new Error("MilestoneArtifactV1: created_at_run_id required");

    if (!m.anchors || typeof m.anchors !== "object") throw new Error("MilestoneArtifactV1: anchors required");
    if (!isStringArray(m.anchors.anchor_projection_refs)) {
        throw new Error("MilestoneArtifactV1: anchors.anchor_projection_refs must be string[]");
    }
    if (!isNonEmptyString(m.anchors.anchor_basis_run_id)) {
        throw new Error("MilestoneArtifactV1: anchors.anchor_basis_run_id required");
    }
}

// milestone_family.assert.ts

import type { MilestoneArtifactV1, ActiveFamilyPointerV1 } from "./milestone_family.types";

const isNonEmptyString = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === "string");

export function assertMilestoneArtifactV1(x: unknown): asserts x is MilestoneArtifactV1 {
    const m = x as MilestoneArtifactV1;

    if (!m || typeof m !== "object") throw new Error("MilestoneArtifactV1: not an object");
    if (m.contract_version !== "v1") throw new Error("MilestoneArtifactV1: contract_version must be v1");
    if (m.artifact_type !== "MILESTONE") throw new Error("MilestoneArtifactV1: artifact_type must be MILESTONE");

    if (!isNonEmptyString(m.milestone_id)) throw new Error("MilestoneArtifactV1: milestone_id required");

    if (m.freshness !== "FRESH" && m.freshness !== "STALE") {
        throw new Error("MilestoneArtifactV1: freshness must be FRESH|STALE");
    }

    // fields
    if (!isNonEmptyString(m.north_star)) throw new Error("MilestoneArtifactV1: north_star required");
    if (!isNonEmptyString(m.scope_fence)) throw new Error("MilestoneArtifactV1: scope_fence required");
    if (!isNonEmptyString(m.tripwires)) throw new Error("MilestoneArtifactV1: tripwires required");
    if (!isNonEmptyString(m.done_receipt)) throw new Error("MilestoneArtifactV1: done_receipt required");

    // provenance
    if (!isNonEmptyString(m.created_from_prompt_card_id)) throw new Error("MilestoneArtifactV1: created_from_prompt_card_id required");
    if (!isNonEmptyString(m.created_at_run_id)) throw new Error("MilestoneArtifactV1: created_at_run_id required");

    // family
    if (!m.family || typeof m.family !== "object") throw new Error("MilestoneArtifactV1: family required");
    if (!isNonEmptyString(m.family.family_id)) throw new Error("MilestoneArtifactV1: family.family_id required");

    if (m.family.family_status !== "ACTIVE" && m.family.family_status !== "ARCHIVED") {
        throw new Error("MilestoneArtifactV1: family.family_status must be ACTIVE|ARCHIVED");
    }

    if (typeof m.family.is_family_head !== "boolean") throw new Error("MilestoneArtifactV1: family.is_family_head must be boolean");
    if (m.family.parent_milestone_id !== undefined && !isNonEmptyString(m.family.parent_milestone_id)) {
        throw new Error("MilestoneArtifactV1: family.parent_milestone_id must be non-empty string if present");
    }

    // anchors optional but must be shaped if present
    if (m.anchors) {
        if (!isNonEmptyString(m.anchors.anchor_basis_run_id)) throw new Error("MilestoneArtifactV1: anchors.anchor_basis_run_id required");
        if (!isStringArray(m.anchors.anchor_projection_refs)) throw new Error("MilestoneArtifactV1: anchors.anchor_projection_refs must be string[]");
    }
}

export function assertActiveFamilyPointerV1(x: unknown): asserts x is ActiveFamilyPointerV1 {
    const p = x as ActiveFamilyPointerV1;
    if (!p || typeof p !== "object") throw new Error("ActiveFamilyPointerV1: not an object");
    if (p.contract_version !== "v1") throw new Error("ActiveFamilyPointerV1: contract_version must be v1");

    if (!isNonEmptyString(p.active_family_id)) throw new Error("ActiveFamilyPointerV1: active_family_id required");
    if (!isNonEmptyString(p.active_head_milestone_id)) throw new Error("ActiveFamilyPointerV1: active_head_milestone_id required");
    if (!isNonEmptyString(p.updated_at_run_id)) throw new Error("ActiveFamilyPointerV1: updated_at_run_id required");
}

// milestone_family.invariants.ts

import type { ActiveFamilyPointerV1, MilestoneArtifactV1 } from "./milestone_family.types";

export interface FamilyInvariantReport {
    ok: boolean;
    errors: string[];
}

/**
 * V1 invariants (the behavior you outlined):
 * - Exactly 0 or 1 ACTIVE family in the dataset (ideally 1 when playing).
 * - If ActiveFamilyPointer exists:
 *   - That family must have exactly one head milestone
 *   - That head must be FRESH
 *   - All other milestones must be STALE
 * - STALE milestones are not reusable (enforced elsewhere), but we encode it by:
 *   - any milestone not in ACTIVE family => family_status ARCHIVED and freshness STALE
 */
export function validateMilestoneFamiliesV1(params: {
    milestones: MilestoneArtifactV1[];
    active?: ActiveFamilyPointerV1 | null;
}): FamilyInvariantReport {
    const { milestones, active } = params;
    const errors: string[] = [];

    const activeFamilies = new Set<string>();
    for (const m of milestones) {
        if (m.family.family_status === "ACTIVE") activeFamilies.add(m.family.family_id);
    }
    if (activeFamilies.size > 1) errors.push(`More than one ACTIVE family found: ${[...activeFamilies].join(", ")}`);

    if (!active) {
        // If there's no active pointer, we accept zero active families (idle state).
        // Still enforce: no milestone should be FRESH without an active family.
        const fresh = milestones.filter((m) => m.freshness === "FRESH");
        if (fresh.length > 0) errors.push(`Found FRESH milestones but no ActiveFamilyPointer set: ${fresh.map((m) => m.milestone_id).join(", ")}`);
        return { ok: errors.length === 0, errors };
    }

    // Active pointer exists
    const activeFamilyId = active.active_family_id;

    const familyMembers = milestones.filter((m) => m.family.family_id === activeFamilyId);
    if (familyMembers.length === 0) errors.push(`ActiveFamilyPointer references missing family_id: ${activeFamilyId}`);

    const heads = familyMembers.filter((m) => m.family.is_family_head);
    if (heads.length !== 1) errors.push(`Active family must have exactly 1 head; found ${heads.length}`);

    const head = heads[0];
    if (head) {
        if (head.milestone_id !== active.active_head_milestone_id) {
            errors.push(`ActiveFamilyPointer.head mismatch: pointer=${active.active_head_milestone_id}, familyHead=${head.milestone_id}`);
        }
        if (head.freshness !== "FRESH") errors.push(`Active head milestone must be FRESH: ${head.milestone_id}`);
    }

    // All non-head members must be STALE
    for (const m of familyMembers) {
        if (!m.family.is_family_head && m.freshness !== "STALE") {
            errors.push(`Non-head milestone in active family must be STALE: ${m.milestone_id}`);
        }
        if (m.family.family_status !== "ACTIVE") {
            errors.push(`Milestone in active family must have family_status ACTIVE: ${m.milestone_id}`);
        }
    }

    // All milestones not in active family must be STALE + ARCHIVED
    for (const m of milestones) {
        if (m.family.family_id !== activeFamilyId) {
            if (m.freshness !== "STALE") errors.push(`Non-active-family milestone must be STALE: ${m.milestone_id}`);
            if (m.family.family_status !== "ARCHIVED") errors.push(`Non-active-family milestone must be ARCHIVED: ${m.milestone_id}`);
            if (m.family.is_family_head && m.family.parent_milestone_id === undefined) {
                // allowed: archived family roots exist; they are just relics
            }
        }
    }

    return { ok: errors.length === 0, errors };
}

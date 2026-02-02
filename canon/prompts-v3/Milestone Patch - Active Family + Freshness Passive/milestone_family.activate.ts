// milestone_family.activate.ts

import type { ActiveFamilyPointerV1, MilestoneArtifactV1, MilestoneFamilyId, MilestoneId, RunId } from "./milestone_family.types";

export function setActiveFamilyHeadV1(params: {
    milestones: MilestoneArtifactV1[];
    familyId: MilestoneFamilyId;
    headMilestoneId: MilestoneId;
    nowRunId: RunId;
}): { active: ActiveFamilyPointerV1; milestones: MilestoneArtifactV1[] } {
    const { milestones, familyId, headMilestoneId, nowRunId } = params;

    const updated = milestones.map((m) => {
        const isInFamily = m.family.family_id === familyId;

        if (isInFamily) {
            const isHead = m.milestone_id === headMilestoneId;
            return {
                ...m,
                freshness: isHead ? ("FRESH" as const) : ("STALE" as const),
                family: {
                    ...m.family,
                    family_status: "ACTIVE" as const,
                    is_family_head: isHead,
                },
                updated_at_run_id: isHead ? nowRunId : m.updated_at_run_id,
            };
        }

        // everything else becomes archived & stale
        return {
            ...m,
            freshness: "STALE" as const,
            family: { ...m.family, family_status: "ARCHIVED" as const, is_family_head: m.family.is_family_head },
        };
    });

    const active: ActiveFamilyPointerV1 = {
        contract_version: "v1",
        active_family_id: familyId,
        active_head_milestone_id: headMilestoneId,
        updated_at_run_id: nowRunId,
    };

    return { active, milestones: updated };
}

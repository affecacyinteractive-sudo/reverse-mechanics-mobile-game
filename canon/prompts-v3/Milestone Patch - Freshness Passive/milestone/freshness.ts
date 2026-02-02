// milestone/freshness.ts

import type { MilestoneArtifactV1, MilestoneId, RunId } from "../contract";

export interface FreshnessResult {
    updated: MilestoneArtifactV1[];
    active_milestone_id: MilestoneId;
}

/**
 * V1 policy:
 * - exactly one active milestone is FRESH
 * - all others become STALE
 */
export function applyFreshnessV1(params: {
    milestones: MilestoneArtifactV1[];
    nextActiveMilestoneId: MilestoneId;
    nowRunId: RunId;
}): FreshnessResult {
    const { milestones, nextActiveMilestoneId, nowRunId } = params;

    const updated = milestones.map((m) => {
        if (m.milestone_id === nextActiveMilestoneId) {
            return {
                ...m,
                freshness: "FRESH",
                updated_at_run_id: nowRunId,
            };
        }
        return {
            ...m,
            freshness: "STALE",
        };
    });

    return { updated, active_milestone_id: nextActiveMilestoneId };
}

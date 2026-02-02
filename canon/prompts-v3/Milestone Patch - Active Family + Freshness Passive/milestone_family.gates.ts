// milestone_family.gates.ts

import type { MilestoneArtifactV1 } from "./milestone_family.types";

export type GateVerdict =
    | { ok: true }
    | { ok: false; fail_code: "MILESTONE_STALE_NOT_REUSABLE"; message: string };

export function blockStaleMilestoneUseV1(m: MilestoneArtifactV1): GateVerdict {
    if (m.freshness === "STALE") {
        return {
            ok: false,
            fail_code: "MILESTONE_STALE_NOT_REUSABLE",
            message: "This milestone is stale and cannot be reused. Use it as reference to create a fresh milestone.",
        };
    }
    return { ok: true };
}

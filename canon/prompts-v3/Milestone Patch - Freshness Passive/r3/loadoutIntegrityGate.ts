// r3/loadoutIntegrityGate.ts (patch idea)

import type { MilestoneArtifactV1 } from "../contract";

export type GateVerdict =
    | { ok: true }
    | { ok: false; fail_code: "MILESTONE_STALE"; message: string };

export function r3GateMilestoneFreshness(m: MilestoneArtifactV1): GateVerdict {
    if (m.freshness === "STALE") {
        return {
            ok: false,
            fail_code: "MILESTONE_STALE",
            message: "This milestone is stale. Create a fresh milestone before running Ritual 3.",
        };
    }
    return { ok: true };
}

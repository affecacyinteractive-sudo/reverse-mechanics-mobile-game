// recommendation/snapshot.ts

import {
    type ActionDef,
    type ActionRecSnapshot,
    type Collectible,
    type CollectibleId,
    type GameStateForRecs,
    type MilestoneField,
    type ProgressFacetR3,
    type RunRecord,
    type TargetsRecSnapshot,
} from "./types";
import { MILESTONE_FIELD_CONF_THRESHOLD, RECENCY_RUN_WINDOW_TARGETS } from "./constants";

/**
 * Tiny deterministic snapshot id so UI/telemetry can reference the same hand.
 * (We keep it stable and simple; you can swap to a real UUID later.)
 */
function makeSnapshotId(prefix: string, nowMs: number): string {
    return `${prefix}:${nowMs.toString(36)}`;
}

function inferMissingFieldsFromConfidence(
    fieldConfidence?: Partial<Record<MilestoneField, number>>,
    explicitMissing?: MilestoneField[]
): MilestoneField[] {
    if (explicitMissing && explicitMissing.length > 0) return [...new Set(explicitMissing)];
    if (!fieldConfidence) return [];
    const all: MilestoneField[] = ["NORTH_STAR", "DONE_RECEIPT", "SCOPE_FENCE", "TRIPWIRES"];
    return all.filter((f) => (fieldConfidence[f] ?? 0) < MILESTONE_FIELD_CONF_THRESHOLD);
}

function inferFullyEnriched(
    isFullyEnriched: boolean | undefined,
    missingFields: MilestoneField[]
): boolean {
    if (typeof isFullyEnriched === "boolean") return isFullyEnriched;
    return missingFields.length === 0;
}

function getLastRun(runs: RunRecord[]): RunRecord | undefined {
    if (!runs.length) return undefined;
    // Assume runs are already chronological; if not, sort by createdAtMs.
    return runs[runs.length - 1];
}

function getLatestR3ProgressFacet(runs: RunRecord[]): ProgressFacetR3 | undefined {
    // Prefer the most recent run that contains an R3 progress facet.
    for (let i = runs.length - 1; i >= 0; i--) {
        const pf = runs[i]?.progressFacet;
        if (pf && pf.type === "P1_PROGRESS") return pf;
    }
    return undefined;
}

export function buildActionRecSnapshot(state: GameStateForRecs, nowMs: number = Date.now()): ActionRecSnapshot {
    const snapshotId = makeSnapshotId("AHS", nowMs);

    const active = state.activeMilestone;
    const missingFields = inferMissingFieldsFromConfidence(active?.fieldConfidence, active?.missingFields);
    const fully = inferFullyEnriched(active?.isFullyEnriched, missingFields);

    const mode = !active ? "FP_START" : fully ? "CHASE" : "ENRICH";

    const lastRun = getLastRun(state.runs);

    return {
        snapshotId,
        generatedAtMs: nowMs,
        mode,
        activeMilestoneId: active?.id,
        missingMilestoneFields: missingFields,
        lastActionId: lastRun?.actionId,
        lastSchool: lastRun?.school,
        latestProgressR3: getLatestR3ProgressFacet(state.runs),
        playerStats: state.playerStats,
    };
}

/**
 * TargetsRecSnapshot needs:
 * - selected action
 * - recent collectibles flattened
 * - milestone composition ids (if available)
 *
 * IMPORTANT: We do NOT surface chunks; we only keep sourceChunkIds for basis notes.
 */
export function buildTargetsRecSnapshot(
    state: GameStateForRecs,
    selectedAction: ActionDef,
    milestoneCompositionIds: CollectibleId[] = [],
    nowMs: number = Date.now()
): TargetsRecSnapshot {
    const snapshotId = makeSnapshotId("THS", nowMs);

    // Flatten collectibles from last N runs (recent-first)
    const recentRuns = state.runs.slice(Math.max(0, state.runs.length - RECENCY_RUN_WINDOW_TARGETS));
    const recentCollectibles: Collectible[] = [];
    for (let i = recentRuns.length - 1; i >= 0; i--) {
        for (const c of recentRuns[i].collectibles) recentCollectibles.push(c);
    }

    return {
        snapshotId,
        generatedAtMs: nowMs,
        activeMilestoneId: state.activeMilestone?.id,
        milestoneCompositionIds: [...new Set(milestoneCompositionIds)],
        selectedAction,
        recentCollectibles,
        playerStats: state.playerStats,
    };
}

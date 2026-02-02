// recommendation/fixtures.ts

import type { ActionDef, Collectible, GameStateForRecs, RunRecord } from "./types";
import { generateActionHand } from "./actionHand";
import { generateTargetsHand } from "./targetsHand";

/**
 * Tiny fixtures to sanity-check deterministic behavior.
 * You can run these in a dev console or node script.
 */

export const actionsFixture: ActionDef[] = [
    { id: "FP-01", title: "North Star", school: "FP", writeEffect: "NONE", fpNoCode: true },
    { id: "FP-02", title: "Scope Fence", school: "FP", writeEffect: "NONE", fpNoCode: true },
    { id: "FP-08", title: "Tripwires", school: "FP", writeEffect: "NONE", fpNoCode: true },
    { id: "FP-10", title: "Done Receipt", school: "FP", writeEffect: "NONE", fpNoCode: true },

    { id: "FI-01", title: "Introduce Feature", school: "FI", writeEffect: "NONE" },
    { id: "FU-03", title: "Understand Current Flow", school: "FU", writeEffect: "NONE" },
    { id: "FPR-02", title: "Present Current Behavior", school: "FPR", writeEffect: "NONE" },
    { id: "FA-02", title: "Abstract Interfaces", school: "FA", writeEffect: "NONE" },
    { id: "FS-01", title: "Synthesize Plan", school: "FS", writeEffect: "NONE" },
];

function c(id: string, type: Collectible["type"], runId: string, school?: Collectible["producedBySchool"]): Collectible {
    return {
        id,
        type,
        title: `${type} ${id}`,
        body: `Body for ${id}`,
        runId,
        producedBySchool: school,
    };
}

export function makeStateFixture(): GameStateForRecs {
    const runs: RunRecord[] = [
        {
            runId: "r1",
            actionId: "FP-01",
            school: "FP",
            milestoneId: "m1",
            collectibles: [c("k1", "K_MILESTONE_NORTH_STAR", "r1", "FP")],
        },
        {
            runId: "r2",
            actionId: "FI-01",
            school: "FI",
            milestoneId: "m1",
            collectibles: [c("k2", "K1_DECISION", "r2", "FI"), c("a1", "F1_ANCHOR", "r2", "FI")],
            progressFacet: {
                type: "P1_PROGRESS",
                progress_label: "PARTIAL",
                progress_score: 0.55,
                in_scope: true,
                next_best_move_hint: "[FU] clarify the moving parts",
            },
        },
        {
            runId: "r3",
            actionId: "FA-02",
            school: "FA",
            milestoneId: "m1",
            collectibles: [c("k3", "K3_SPEC", "r3", "FA"), c("k4", "K2_PLAN", "r3", "FA")],
        },
    ];

    return {
        activeMilestone: {
            id: "m1",
            fieldConfidence: {
                NORTH_STAR: 0.9,
                SCOPE_FENCE: 0.5,
                TRIPWIRES: 0.4,
                DONE_RECEIPT: 0.6,
            },
        },
        completedMilestones: ["m0"],
        runs,
        playerStats: {
            schoolPickCounts: { FI: 3, FU: 4, FA: 2 },
            recentlyPickedActions: ["FI-01", "FU-03"],
        },
    };
}

export function sanityDemo(): void {
    const state = makeStateFixture();
    const actionHand = generateActionHand({ state, actions: actionsFixture, nowMs: 1234567890 });

    // Pick action #1 as if user tapped it
    const picked = actionHand.actions[0]?.item ?? actionsFixture.find((x) => x.id === "FI-01")!;
    const targetsHand = generateTargetsHand({
        state,
        selectedAction: picked,
        milestoneCompositionIds: ["k1"], // pretend milestone composition contains north star
        nowMs: 1234567890,
    });

    // eslint-disable-next-line no-console
    console.log("ActionHand:", actionHand);

    // eslint-disable-next-line no-console
    console.log("TargetsHand:", targetsHand);
}

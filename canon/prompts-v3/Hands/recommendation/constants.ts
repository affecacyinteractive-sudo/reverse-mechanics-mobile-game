// recommendation/constants.ts

import type { MilestoneField, School } from "./types";

export const DEFAULT_ACTION_HAND_SIZE = 5 as const; // you can render 4–5; default 5
export const DEFAULT_TARGETS_HAND_SIZE = 5 as const; // 4–6; default 5

export const RECENCY_RUN_WINDOW_ACTIONS = 6 as const; // last N runs to consider for variety/stability
export const RECENCY_RUN_WINDOW_TARGETS = 5 as const; // last N runs to search for target candidates

export const MILESTONE_FIELD_CONF_THRESHOLD = 0.7 as const;

export const SCHOOL_SEQUENCE: School[] = ["FP", "FI", "FU", "FPR", "FA", "FS"];

export const ADJACENCY_NEXT: Record<School, School[]> = {
    FP: ["FI"],
    FI: ["FU"],
    FU: ["FPR", "FA"],
    FPR: ["FA", "FS"],
    FA: ["FS"],
    FS: ["FI", "FU"],
};

export const MILESTONE_FIELD_TO_FP_ACTION: Record<MilestoneField, string> = {
    NORTH_STAR: "FP-01",
    SCOPE_FENCE: "FP-02",
    TRIPWIRES: "FP-08",
    DONE_RECEIPT: "FP-10",
};

export const TARGETABLE_COLLECTIBLE_TYPES = {
    // Keystones (always targetable)
    keystones: new Set([
        "K1_DECISION",
        "K2_PLAN",
        "K3_SPEC",
        "K4_RATIONALE",
        "K_CODE_PATCH",
        "K_MILESTONE_NORTH_STAR",
        "K_MILESTONE_DONE_RECEIPT",
        "K_MILESTONE_SCOPE_FENCE",
        "K_MILESTONE_TRIPWIRES",
    ]),
    // Facets (targetable only if object-like)
    objectLikeFacets: new Set(["F1_ANCHOR", "F2_PROOF"]),
    // Progress facets are NOT targetable by default
    statusFacets: new Set(["P1_PROGRESS", "P_MILESTONE_PROGRESS"]),
};

export const SCORE_WEIGHTS = {
    milestoneLinked: 4.0,
    actionSchoolMatch: 3.0,
    adjacencySchoolMatch: 1.5,
    recency: 2.0,
    playerPreference: 1.0,
    diversityPenalty: -1.25,
} as const;

export const HARD_CONSTRAINTS = {
    fsRequiresFa: "FS requires FA-derived targets (abstractions).",
} as const;

// recommendation/types.ts

export type School = "FP" | "FI" | "FU" | "FPR" | "FA" | "FS";
export type ActionId = string;
export type RunId = string;
export type MilestoneId = string;
export type CollectibleId = string;

export type WriteEffect = "NONE" | "ISSUES" | "CODEBASE" | "BOTH";

export type MilestoneField = "NORTH_STAR" | "DONE_RECEIPT" | "SCOPE_FENCE" | "TRIPWIRES";

export type ActionRecMode = "FP_START" | "ENRICH" | "CHASE";

export type BasisTag =
    | "progress_proxy"
    | "adjacency"
    | "stability"
    | "variety"
    | "player_style"
    | "milestone_linked"
    | "recent_output"
    | "foundation"
    | "fs_requires_fa";

export interface ActionDef {
    id: ActionId;
    title: string;
    school: School;
    // Used for pruning (no code generation for FP; patching logic for write actions, etc.)
    writeEffect: WriteEffect;
    fpNoCode?: boolean;
    // Optional: light metadata for better ordering later
    tags?: string[];
}

export type CollectibleType =
// Keystones (examples)
    | "K1_DECISION"
    | "K2_PLAN"
    | "K3_SPEC"
    | "K4_RATIONALE"
    | "K_CODE_PATCH"
    // Facets (examples)
    | "F1_ANCHOR"
    | "F2_PROOF"
    // Progress facets (not targetable by default)
    | "P1_PROGRESS"
    | "P_MILESTONE_PROGRESS"
    // Milestone keystone fragments (R2)
    | "K_MILESTONE_NORTH_STAR"
    | "K_MILESTONE_DONE_RECEIPT"
    | "K_MILESTONE_SCOPE_FENCE"
    | "K_MILESTONE_TRIPWIRES";

export interface Collectible {
    id: CollectibleId;
    type: CollectibleType;
    title: string;
    body: string;
    runId: RunId;

    producedByActionId?: ActionId;
    producedBySchool?: School;

    milestoneId?: MilestoneId;

    // Used internally for “basis note” only (never shown as a selectable chunk)
    sourceChunkIds?: string[];

    createdAtMs?: number;
}

export interface ProgressFacetR3 {
    type: "P1_PROGRESS";
    progress_label: "ADVANCED" | "PARTIAL" | "STALLED" | "DRIFT";
    progress_score: number;
    in_scope: boolean;
    next_best_move_hint: string; // optional parse prefix later
}

export interface ProgressFacetR2 {
    type: "P_MILESTONE_PROGRESS";
    progress_label: "READY" | "SOFT_GAP" | "THIN" | "CONFLICTED";
    progress_score: number;
    missing_fields: MilestoneField[];
    weak_fields: MilestoneField[];
    enrichment_hint: string;
}

export type ProgressFacet = ProgressFacetR2 | ProgressFacetR3;

export interface RunRecord {
    runId: RunId;
    actionId: ActionId;
    school: School;
    milestoneId?: MilestoneId;

    collectibles: Collectible[];

    // Optional: cached from R2/R3 pipeline
    progressFacet?: ProgressFacet;

    createdAtMs?: number;
}

export interface ActiveMilestoneSignals {
    id: MilestoneId;

    // If you already compute this, great. If not, we infer from fieldConfidence.
    isFullyEnriched?: boolean;

    // Confidence per field (0–1). Missing field = absent or < threshold.
    fieldConfidence?: Partial<Record<MilestoneField, number>>;

    // Optional convenience if you already have it:
    missingFields?: MilestoneField[];
}

export interface PlayerStats {
    // Minimal personalization signal
    schoolPickCounts?: Partial<Record<School, number>>;
    recentlyPickedActions?: ActionId[];
}

export interface GameStateForRecs {
    // Active milestone chase object (may be absent during FP-start)
    activeMilestone?: ActiveMilestoneSignals;

    // Completed milestones may exist (not needed for v1 of recommenders)
    completedMilestones?: MilestoneId[];

    // Recent run history (you’ll likely have far more; we just need last few)
    runs: RunRecord[];

    // Optional personalization
    playerStats?: PlayerStats;

    // Optional availability constraints: you can keep it simple for now
    unavailableActionIds?: Set<ActionId>;
}

export interface HandItem<T> {
    item: T;
    basisTag: BasisTag;
    basisNote: string; // tiny human line: “recent output”, “milestone-linked”, etc.
    score: number; // for debugging + ordering
}

export interface ActionHand {
    mode: ActionRecMode;
    snapshotId: string;
    generatedAtMs: number;

    actions: HandItem<ActionDef>[];

    // If you want to show a tiny rule: “FS requires FA targets”
    hardConstraints: string[];
}

export interface TargetsHand {
    snapshotId: string;
    generatedAtMs: number;

    // 4–6 candidate target collectibles
    targets: HandItem<Collectible>[];

    hardConstraints: string[];
}

export interface ActionRecSnapshot {
    snapshotId: string;
    generatedAtMs: number;

    mode: ActionRecMode;

    activeMilestoneId?: MilestoneId;
    missingMilestoneFields: MilestoneField[];

    lastActionId?: ActionId;
    lastSchool?: School;

    // latest progress facet from R3 (preferred), else absent
    latestProgressR3?: ProgressFacetR3;

    // personalization
    playerStats?: PlayerStats;
}

export interface TargetsRecSnapshot {
    snapshotId: string;
    generatedAtMs: number;

    activeMilestoneId?: MilestoneId;
    // milestone “composition” collectible ids (authoritative)
    milestoneCompositionIds: CollectibleId[];

    selectedAction: ActionDef;

    // recent collectibles (flattened, already in recency order)
    recentCollectibles: Collectible[];

    playerStats?: PlayerStats;
}

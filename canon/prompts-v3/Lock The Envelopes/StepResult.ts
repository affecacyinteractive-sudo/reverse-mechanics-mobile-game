type StepStatus = "PASS" | "FAIL" | "SKIP";

type UserActionRequired =
    | "NONE"
    | "NEW_PROMPT_CARD"
    | "EDIT_PROMPT"
    | "SELECT_UNFINISHED_MILESTONE"
    | "SELECT_ACTIVE_MILESTONE_OR_CREATE_NEW"
    | "RUN_FP_LENS_FOR_CORE"
    | "ADD_TARGETS"
    | "ADD_PROJECTIONS"
    | "REDUCE_SCOPE"
    | "REPORT_BUG";

type StepResultV1 = {
    contract_version: "v1";

    // Identity
    ritual: "R1" | "R2" | "R3";
    run_id: string;
    step_id: string;          // e.g. "R3.S12.v1"
    step_name: string;        // short human label, stable

    // Outcome
    status: StepStatus;
    fail_code?: string;       // present when FAIL
    retryable: boolean;
    retry_from_step?: string; // set only when retryable=true
    user_action_required: UserActionRequired;

    // Human-facing seal copy (orchestrator-generated)
    seal_title: string;       // short, punchy
    seal_body?: string;       // 1–2 lines max
    highlights?: string[];    // 0–3 chips

    // Structured useful facts for UI (optional)
    counts?: Partial<{
        targets_selected: number;
        targets_mounted_chunks: number;
        projections_selected: number;
        projections_mounted: number;
        chunks_generated: number;
        collectibles_generated: number;
        issues_upserted: number;
        issues_closed: number;
    }>;

    // Tiny debugging + trace (bounded)
    notes?: string;           // short, non-sensitive
    blame_step_id?: string;   // optional: where failure likely originated (if you track it)
    ts_iso: string;           // event timestamp
};

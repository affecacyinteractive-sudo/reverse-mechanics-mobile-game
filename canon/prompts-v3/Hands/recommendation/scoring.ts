// recommendation/scoring.ts

import type { ActionDef, ActionId, ActionRecSnapshot, PlayerStats, School } from "./types";
import { SCORE_WEIGHTS } from "./constants";
import { seededSort } from "./pools";
import { getAdjacencySchools } from "./actionCatalog";

/**
 * Scoring is intentionally simple and legible.
 * You can tune weights later without changing selection logic.
 */

export type ActionBasis =
    | "progress_proxy"
    | "adjacency"
    | "stability"
    | "variety"
    | "player_style"
    | "milestone_enrichment";

export interface ScoredAction {
    action: ActionDef;
    score: number;
    basis: ActionBasis;
    note: string;
}

export function preferredSchoolFromPlayer(stats?: PlayerStats): School | undefined {
    const counts = stats?.schoolPickCounts;
    if (!counts) return undefined;

    let best: { s: School; c: number } | undefined;
    for (const s of Object.keys(counts) as School[]) {
        const c = counts[s] ?? 0;
        if (!best || c > best.c) best = { s, c };
    }
    return best?.s;
}

export function parseProgressHintToSchool(snapshot: ActionRecSnapshot): School | undefined {
    const pf = snapshot.latestProgressR3;
    if (!pf) return undefined;

    // If you adopt the “[FI] …” tags, parse them.
    const hint = (pf.next_best_move_hint ?? "").trim();
    const tag = hint.match(/^\[(FI|FU|FPR|FA|FS|ENRICH)\]/i)?.[1]?.toUpperCase();

    if (tag === "FI") return "FI";
    if (tag === "FU") return "FU";
    if (tag === "FPR") return "FPR";
    if (tag === "FA") return "FA";
    if (tag === "FS") return "FS";
    if (tag === "ENRICH") return "FP"; // enrichment means FP actions

    // If you use “Next move: INTENT — …”
    const intent = hint.match(/^Next move:\s*(INTRODUCE|UNDERSTAND|PRESENT|ABSTRACT|SYNTHESIZE|PATCH|ENRICH)\b/i)?.[1]?.toUpperCase();
    if (intent === "INTRODUCE") return "FI";
    if (intent === "UNDERSTAND") return "FU";
    if (intent === "PRESENT") return "FPR";
    if (intent === "ABSTRACT") return "FA";
    if (intent === "SYNTHESIZE") return "FS";
    if (intent === "PATCH") return "FI"; // “patch” tends to be FI-ish in your schools (feature edits)
    if (intent === "ENRICH") return "FP";

    // Fallback: use label only.
    if (pf.progress_label === "DRIFT") return "FU";
    if (pf.progress_label === "STALLED") return "FU";
    if (pf.progress_label === "PARTIAL") return "FPR";
    if (pf.progress_label === "ADVANCED") return undefined;

    return undefined;
}

export function scoreForSchoolMatch(action: ActionDef, desired?: School): number {
    if (!desired) return 0;
    return action.school === desired ? SCORE_WEIGHTS.actionSchoolMatch : 0;
}

export function scoreForAdjacency(action: ActionDef, snapshot: ActionRecSnapshot): number {
    const adj = getAdjacencySchools(snapshot.lastSchool);
    return adj.includes(action.school) ? SCORE_WEIGHTS.adjacencySchoolMatch : 0;
}

export function scorePlayerPreference(action: ActionDef, stats?: PlayerStats): number {
    const pref = preferredSchoolFromPlayer(stats);
    if (!pref) return 0;
    return action.school === pref ? SCORE_WEIGHTS.playerPreference : 0;
}

export function scoreNovelty(action: ActionDef, recentActionIds: ActionId[]): number {
    // Prefer actions not seen recently; simple penalty if present.
    return recentActionIds.includes(action.id) ? -1.0 : 0.5;
}

export function pickBestAction(params: {
    candidates: ActionDef[];
    seedKey: string;
    scoreFn: (a: ActionDef) => ScoredAction;
}): ScoredAction | undefined {
    const { candidates, seedKey, scoreFn } = params;
    if (!candidates.length) return undefined;

    // Compute scores
    let scored = candidates.map(scoreFn);

    // Stable tie-breaking so the hand feels alive but deterministic
    scored = seededSort(scored, seedKey, (x) => `${x.action.id}:${Math.round(x.score * 1000)}`);

    // Then pick the highest score
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
}

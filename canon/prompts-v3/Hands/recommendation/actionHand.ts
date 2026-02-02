// recommendation/actionHand.ts

import type {
    ActionDef,
    ActionHand,
    ActionId,
    ActionRecSnapshot,
    GameStateForRecs,
    HandItem,
    School,
} from "./types";
import { DEFAULT_ACTION_HAND_SIZE, HARD_CONSTRAINTS, SCORE_WEIGHTS } from "./constants";
import { buildActionRecSnapshot } from "./snapshot";
import {
    eligibleActionsForMode,
    fpActionsForMissingFields,
    hasFAArtifacts,
    indexActionCatalog,
    defaultFpSequence,
} from "./actionCatalog";
import {
    parseProgressHintToSchool,
    pickBestAction,
    scoreForAdjacency,
    scoreForSchoolMatch,
    scoreNovelty,
    scorePlayerPreference,
    type ScoredAction,
} from "./scoring";
import { uniqueBy } from "./pools";

/**
 * Implements AHS.S0–AHS.S12.
 * Deterministic. No LLM calls.
 */

function recentActionIds(state: GameStateForRecs, limit: number = 8): ActionId[] {
    const out: ActionId[] = [];
    for (let i = state.runs.length - 1; i >= 0 && out.length < limit; i--) {
        out.push(state.runs[i].actionId);
    }
    return out;
}

function basisToTag(basis: ScoredAction["basis"]): HandItem<ActionDef>["basisTag"] {
    if (basis === "progress_proxy") return "progress_proxy";
    if (basis === "adjacency") return "adjacency";
    if (basis === "stability") return "stability";
    if (basis === "variety") return "variety";
    if (basis === "player_style") return "player_style";
    return "milestone_linked"; // milestone_enrichment
}

function noteForBasis(basis: ScoredAction["basis"], snapshot: ActionRecSnapshot): string {
    switch (basis) {
        case "progress_proxy":
            return snapshot.latestProgressR3 ? "Based on latest progress signal." : "Based on recent posture.";
        case "adjacency":
            return "Natural next move in the flow.";
        case "stability":
            return "Stability move to reduce drift later.";
        case "variety":
            return "A plausible alternate path.";
        case "player_style":
            return "Matches your usual style.";
        case "milestone_enrichment":
            return "Completes milestone enrichment.";
        default:
            return "Suggested.";
    }
}

function pushHandItem(
    hand: HandItem<ActionDef>[],
    scored?: ScoredAction
): void {
    if (!scored) return;
    hand.push({
        item: scored.action,
        basisTag: basisToTag(scored.basis),
        basisNote: scored.note,
        score: scored.score,
    });
}

function filterOutChosen(candidates: ActionDef[], chosen: HandItem<ActionDef>[]): ActionDef[] {
    const chosenIds = new Set(chosen.map((x) => x.item.id));
    return candidates.filter((a) => !chosenIds.has(a.id));
}

/**
 * Slot scoring templates (simple & legible).
 */
function scoreProgressSlot(a: ActionDef, snapshot: ActionRecSnapshot, desiredSchool?: School, recentIds: ActionId[]): ScoredAction {
    const score =
        scoreForSchoolMatch(a, desiredSchool) +
        scoreForAdjacency(a, snapshot) * 0.5 +
        scorePlayerPreference(a, snapshot.playerStats) * 0.25 +
        scoreNovelty(a, recentIds);

    return {
        action: a,
        score,
        basis: "progress_proxy",
        note: noteForBasis("progress_proxy", snapshot),
    };
}

function scoreAdjacencySlot(a: ActionDef, snapshot: ActionRecSnapshot, recentIds: ActionId[]): ScoredAction {
    const score =
        scoreForAdjacency(a, snapshot) +
        scorePlayerPreference(a, snapshot.playerStats) * 0.25 +
        scoreNovelty(a, recentIds);

    return {
        action: a,
        score,
        basis: "adjacency",
        note: noteForBasis("adjacency", snapshot),
    };
}

function scoreStabilitySlot(a: ActionDef, snapshot: ActionRecSnapshot, stabilitySchool?: School, recentIds: ActionId[]): ScoredAction {
    const score =
        scoreForSchoolMatch(a, stabilitySchool) * 0.9 +
        scoreForAdjacency(a, snapshot) * 0.25 +
        scorePlayerPreference(a, snapshot.playerStats) * 0.25 +
        scoreNovelty(a, recentIds);

    return {
        action: a,
        score,
        basis: "stability",
        note: noteForBasis("stability", snapshot),
    };
}

function scoreVarietySlot(a: ActionDef, snapshot: ActionRecSnapshot, avoidSchools: Set<School>, recentIds: ActionId[]): ScoredAction {
    const varietyBonus = avoidSchools.has(a.school) ? SCORE_WEIGHTS.diversityPenalty : 0.75;
    const score =
        varietyBonus +
        scoreForAdjacency(a, snapshot) * 0.15 +
        scorePlayerPreference(a, snapshot.playerStats) * 0.35 +
        scoreNovelty(a, recentIds);

    return {
        action: a,
        score,
        basis: "variety",
        note: noteForBasis("variety", snapshot),
    };
}

function scorePlayerSlot(a: ActionDef, snapshot: ActionRecSnapshot, preferred?: School, recentIds: ActionId[]): ScoredAction {
    const score =
        scoreForSchoolMatch(a, preferred) +
        scoreNovelty(a, recentIds) * 0.5;

    return {
        action: a,
        score,
        basis: "player_style",
        note: noteForBasis("player_style", snapshot),
    };
}

/**
 * Main entry.
 */
export function generateActionHand(params: {
    state: GameStateForRecs;
    actions: ActionDef[];
    nowMs?: number;
}): ActionHand {
    const { state, actions, nowMs } = params;

    const snapshot = buildActionRecSnapshot(state, nowMs ?? Date.now());
    const catalog = indexActionCatalog(actions);

    const missingFpActions = fpActionsForMissingFields(snapshot.missingMilestoneFields);
    const eligible = eligibleActionsForMode({
        state,
        catalog,
        mode: snapshot.mode,
        missingFpActionIds: missingFpActions,
    });

    const recentIds = recentActionIds(state, 10);

    // Decide hand size
    const targetHandSize =
        snapshot.mode === "FP_START" ? 4 : DEFAULT_ACTION_HAND_SIZE;

    const hand: HandItem<ActionDef>[] = [];
    const hardConstraints: string[] = [];

    // --- FP_START: almost always the canonical FP sequence
    if (snapshot.mode === "FP_START") {
        const seq = defaultFpSequence();
        for (const id of seq) {
            const a = catalog.byId.get(id);
            if (!a) continue;
            if (state.unavailableActionIds?.has(a.id)) continue;
            hand.push({
                item: a,
                basisTag: "milestone_linked",
                basisNote: "Milestone creation flow.",
                score: 10,
            });
        }

        // Ensure exactly 4
        const dedup = uniqueBy(hand, (x) => x.item.id).slice(0, 4);

        return {
            mode: snapshot.mode,
            snapshotId: snapshot.snapshotId,
            generatedAtMs: snapshot.generatedAtMs,
            actions: dedup,
            hardConstraints,
        };
    }

    // --- ENRICH: prioritize missing FP actions first (1–2 slots), then dynamic mix
    if (snapshot.mode === "ENRICH" && missingFpActions.length > 0) {
        for (const id of missingFpActions.slice(0, 2)) {
            const a = catalog.byId.get(id);
            if (!a) continue;
            if (!eligible.find((x) => x.id === a.id)) continue;
            hand.push({
                item: a,
                basisTag: "milestone_linked",
                basisNote: "Completes milestone enrichment.",
                score: 12,
            });
        }
    }

    // --- CHASE/ENRICH dynamic slots
    const progressSchoolHint = parseProgressHintToSchool(snapshot);
    const slot1 = pickBestAction({
        candidates: filterOutChosen(eligible, hand),
        seedKey: `${snapshot.snapshotId}:slot1`,
        scoreFn: (a) => scoreProgressSlot(a, snapshot, progressSchoolHint, recentIds),
    });
    pushHandItem(hand, slot1);

    const slot2 = pickBestAction({
        candidates: filterOutChosen(eligible, hand),
        seedKey: `${snapshot.snapshotId}:slot2`,
        scoreFn: (a) => scoreAdjacencySlot(a, snapshot, recentIds),
    });
    pushHandItem(hand, slot2);

    // Stability pick: default FA, but if drift/stall, bias FU
    let stabilitySchool: School | undefined = "FA";
    const pf = snapshot.latestProgressR3;
    if (pf?.progress_label === "DRIFT" || pf?.progress_label === "STALLED") stabilitySchool = "FU";

    const slot3 = pickBestAction({
        candidates: filterOutChosen(eligible, hand),
        seedKey: `${snapshot.snapshotId}:slot3`,
        scoreFn: (a) => scoreStabilitySlot(a, snapshot, stabilitySchool, recentIds),
    });
    pushHandItem(hand, slot3);

    // Variety: avoid repeating the schools already present
    const usedSchools = new Set(hand.map((x) => x.item.school));
    const slot4 = pickBestAction({
        candidates: filterOutChosen(eligible, hand),
        seedKey: `${snapshot.snapshotId}:slot4`,
        scoreFn: (a) => scoreVarietySlot(a, snapshot, usedSchools, recentIds),
    });
    pushHandItem(hand, slot4);

    // Optional slot5: player preference
    if (hand.length < targetHandSize) {
        const preferred = (snapshot.playerStats?.schoolPickCounts
            ? (Object.entries(snapshot.playerStats.schoolPickCounts)
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as School | undefined)
            : undefined);

        const slot5 = pickBestAction({
            candidates: filterOutChosen(eligible, hand),
            seedKey: `${snapshot.snapshotId}:slot5`,
            scoreFn: (a) => scorePlayerSlot(a, snapshot, preferred, recentIds),
        });
        pushHandItem(hand, slot5);
    }

    // --- Guardrails / final validation
    // 1) Deduplicate
    let finalHand = uniqueBy(hand, (x) => x.item.id);

    // 2) Enforce “max 1 FP action in CHASE”
    if (snapshot.mode === "CHASE") {
        const fp = finalHand.filter((x) => x.item.school === "FP");
        if (fp.length > 1) {
            // keep the highest score FP (if any), drop others
            fp.sort((a, b) => b.score - a.score);
            const keepId = fp[0].item.id;
            finalHand = finalHand.filter((x) => x.item.school !== "FP" || x.item.id === keepId);
        }
    }

    // 3) FS should only appear if FA artifacts exist (avoid trap)
    const fsInHand = finalHand.some((x) => x.item.school === "FS");
    if (fsInHand && !hasFAArtifacts(state)) {
        // Replace FS with best FA or FU fallback
        finalHand = finalHand.filter((x) => x.item.school !== "FS");
        const fallback = pickBestAction({
            candidates: eligible.filter((a) => a.school === "FA" || a.school === "FU"),
            seedKey: `${snapshot.snapshotId}:fs_fallback`,
            scoreFn: (a) => ({
                action: a,
                score: 9 + scoreNovelty(a, recentIds),
                basis: "stability",
                note: "Avoided FS (no abstractions yet).",
            }),
        });
        if (fallback) {
            finalHand.push({
                item: fallback.action,
                basisTag: "stability",
                basisNote: fallback.note,
                score: fallback.score,
            });
        }
    } else if (fsInHand) {
        hardConstraints.push(HARD_CONSTRAINTS.fsRequiresFa);
    }

    // 4) Ensure at least 2 schools in CHASE (avoid monotony)
    if (snapshot.mode === "CHASE") {
        const schools = new Set(finalHand.map((x) => x.item.school));
        if (schools.size < 2) {
            const alt = pickBestAction({
                candidates: eligible.filter((a) => a.school !== finalHand[0]?.item.school),
                seedKey: `${snapshot.snapshotId}:diversity_fix`,
                scoreFn: (a) => ({
                    action: a,
                    score: 8 + scoreNovelty(a, recentIds),
                    basis: "variety",
                    note: "Added variety for momentum.",
                }),
            });
            if (alt) {
                finalHand.push({
                    item: alt.action,
                    basisTag: "variety",
                    basisNote: alt.note,
                    score: alt.score,
                });
            }
        }
    }

    // 5) Clamp size (prefer 5; allow 4 if pool is thin)
    finalHand = uniqueBy(finalHand, (x) => x.item.id);
    finalHand.sort((a, b) => b.score - a.score);

    if (finalHand.length > targetHandSize) finalHand = finalHand.slice(0, targetHandSize);
    if (finalHand.length < 4) {
        // last-resort: fill from eligible
        const fill = eligible.filter((a) => !finalHand.some((x) => x.item.id === a.id));
        for (const a of fill) {
            if (finalHand.length >= 4) break;
            finalHand.push({
                item: a,
                basisTag: "variety",
                basisNote: "Fallback candidate.",
                score: 1,
            });
        }
    }

    // Add basis notes (ensure not empty)
    finalHand = finalHand.map((x) => ({
        ...x,
        basisNote: x.basisNote?.trim() ? x.basisNote : noteForBasis("variety", snapshot),
    }));

    return {
        mode: snapshot.mode,
        snapshotId: snapshot.snapshotId,
        generatedAtMs: snapshot.generatedAtMs,
        actions: finalHand,
        hardConstraints,
    };
}

// recommendation/targetsHand.ts

import type {
    ActionDef,
    Collectible,
    CollectibleId,
    CollectibleType,
    GameStateForRecs,
    HandItem,
    School,
    TargetsHand,
    TargetsRecSnapshot,
} from "./types";
import {
    DEFAULT_TARGETS_HAND_SIZE,
    HARD_CONSTRAINTS,
    SCORE_WEIGHTS,
    TARGETABLE_COLLECTIBLE_TYPES,
} from "./constants";
import { buildTargetsRecSnapshot } from "./snapshot";
import { clamp, diversifyBy, scoreRecency, uniqueBy } from "./pools";
import { hasFAArtifacts } from "./actionCatalog";

/**
 * Implements THS.S0–THS.S9.
 * Deterministic. No LLM calls.
 *
 * Philosophy:
 * - Hand shows collectibles only (never chunks).
 * - 3 sources:
 *   A) Recency + compatibility
 *   B) Milestone-linked composition
 *   C) One smart wildcard (foundation / player-favorite)
 * - FS requires FA-derived keystones if available; avoid traps.
 */

type PoolLabel = "A_recent" | "B_milestone" | "C_wildcard" | "FS_required_fa";

function isTargetableType(t: CollectibleType, actionSchool: School): boolean {
    // Keystones always targetable
    if (TARGETABLE_COLLECTIBLE_TYPES.keystones.has(t)) return true;

    // Object-like facets sometimes targetable
    if (TARGETABLE_COLLECTIBLE_TYPES.objectLikeFacets.has(t)) return true;

    // Status facets are not targetable as objects
    if (TARGETABLE_COLLECTIBLE_TYPES.statusFacets.has(t)) return false;

    // Unknown types: be safe and disallow
    return false;
}

function actionSchoolCompatibilityScore(actionSchool: School, c: Collectible): number {
    // very light posture match; can be tuned later
    const produced = c.producedBySchool;
    if (!produced) return 0;

    if (produced === actionSchool) return SCORE_WEIGHTS.actionSchoolMatch;

    // adjacency-lite: treat FI/FU/FPR/FA/FS as closer neighbors than FP
    // (this is intentionally simple; you can tighten later)
    const closePairs: Array<[School, School]> = [
        ["FI", "FU"],
        ["FU", "FPR"],
        ["FPR", "FA"],
        ["FA", "FS"],
        ["FS", "FI"],
    ];
    for (const [a, b] of closePairs) {
        if ((produced === a && actionSchool === b) || (produced === b && actionSchool === a)) {
            return SCORE_WEIGHTS.adjacencySchoolMatch;
        }
    }
    return 0;
}

function basisNote(label: PoolLabel, actionSchool: School): string {
    if (label === "FS_required_fa") return "Needed for synthesis (from abstraction).";
    if (label === "B_milestone") return "Milestone-linked.";
    if (label === "A_recent") return "Recent output.";
    if (label === "C_wildcard") return "Foundation pick.";
    return `Suggested for ${actionSchool}.`;
}

function resolveMilestoneCompositionCollectibles(
    allCollectibles: Collectible[],
    compositionIds: CollectibleId[]
): Collectible[] {
    const byId = new Map<CollectibleId, Collectible>();
    for (const c of allCollectibles) byId.set(c.id, c);

    const out: Collectible[] = [];
    for (const id of compositionIds) {
        const c = byId.get(id);
        if (c) out.push(c);
    }
    return out;
}

function scoreCollectible(params: {
    c: Collectible;
    label: PoolLabel;
    action: ActionDef;
    recencyIndex: number; // 0=newest
    playerFavIds: Set<CollectibleId>;
}): HandItem<Collectible> {
    const { c, label, action, recencyIndex, playerFavIds } = params;

    // base: pool importance
    let score = 0;
    if (label === "B_milestone") score += SCORE_WEIGHTS.milestoneLinked;
    if (label === "A_recent") score += SCORE_WEIGHTS.recency * scoreRecency(recencyIndex);
    if (label === "C_wildcard") score += 0.75;
    if (label === "FS_required_fa") score += 5.0;

    // compatibility
    score += actionSchoolCompatibilityScore(action.school, c);

    // player bias
    if (playerFavIds.has(c.id)) score += SCORE_WEIGHTS.playerPreference;

    // tiny prefer keystones over facets as “objects”
    if (TARGETABLE_COLLECTIBLE_TYPES.keystones.has(c.type)) score += 0.35;
    if (TARGETABLE_COLLECTIBLE_TYPES.objectLikeFacets.has(c.type)) score += 0.1;

    return {
        item: c,
        basisTag: label === "B_milestone" ? "milestone_linked" : label === "A_recent" ? "recent_output" : label === "C_wildcard" ? "foundation" : "fs_requires_fa",
        basisNote: basisNote(label, action.school),
        score,
    };
}

function collectPlayerFavoriteIds(snapshot: TargetsRecSnapshot): Set<CollectibleId> {
    // Minimal v1: none (unless you track it). Kept as a hook.
    return new Set<CollectibleId>();
}

function enforceFsFaConstraint(params: {
    state: GameStateForRecs;
    action: ActionDef;
    recentCollectibles: Collectible[];
}): { status: "OK" | "WEAK" | "FAIL"; faKeystones: Collectible[] } {
    const { state, action, recentCollectibles } = params;

    if (action.school !== "FS") return { status: "OK", faKeystones: [] };

    // If no FA artifacts exist, constraint fails.
    if (!hasFAArtifacts(state)) return { status: "FAIL", faKeystones: [] };

    // FA-derived keystones pool
    const faKeystones = recentCollectibles.filter(
        (c) => c.producedBySchool === "FA" && TARGETABLE_COLLECTIBLE_TYPES.keystones.has(c.type)
    );

    if (faKeystones.length >= 2) return { status: "OK", faKeystones };
    if (faKeystones.length === 1) return { status: "WEAK", faKeystones };
    return { status: "WEAK", faKeystones: [] }; // FA exists but keystone pool may be thin
}

function sortDesc<T>(items: HandItem<T>[]): HandItem<T>[] {
    return [...items].sort((a, b) => b.score - a.score);
}

export function generateTargetsHand(params: {
    state: GameStateForRecs;
    selectedAction: ActionDef;
    // milestone composition ids are authoritative if you have them (composition block in milestone_state)
    milestoneCompositionIds?: CollectibleId[];
    nowMs?: number;
}): TargetsHand {
    const { state, selectedAction, milestoneCompositionIds, nowMs } = params;

    const snapshot = buildTargetsRecSnapshot(
        state,
        selectedAction,
        milestoneCompositionIds ?? [],
        nowMs ?? Date.now()
    );

    const hardConstraints: string[] = [];

    // Flatten all collectibles we can see (recent only in snapshot)
    const recentCollectibles = snapshot.recentCollectibles;

    // Filter to targetable collectibles for this action
    const targetableRecent = recentCollectibles.filter((c) => isTargetableType(c.type, selectedAction.school));

    // --- FS/FA constraint
    const fsConstraint = enforceFsFaConstraint({
        state,
        action: selectedAction,
        recentCollectibles: targetableRecent,
    });

    if (selectedAction.school === "FS") {
        hardConstraints.push(HARD_CONSTRAINTS.fsRequiresFa);
    }

    // Build pool B: milestone-linked
    const poolB = snapshot.activeMilestoneId
        ? resolveMilestoneCompositionCollectibles(targetableRecent, snapshot.milestoneCompositionIds)
        : [];

    // Build pool A: recency + compatibility (just use targetableRecent)
    const poolA = targetableRecent;

    // Build pool C: one foundation wildcard (older / reusable)
    // Deterministic v1: pick the first strong-looking keystone not in poolB.
    const poolC: Collectible[] = [];
    for (const c of targetableRecent.slice().reverse()) {
        // reverse => older-ish within the window
        if (!TARGETABLE_COLLECTIBLE_TYPES.keystones.has(c.type)) continue;
        if (poolB.some((x) => x.id === c.id)) continue;
        poolC.push(c);
        break;
    }

    // Player favorites hook
    const playerFav = collectPlayerFavoriteIds(snapshot);

    // Score candidates
    const scored: HandItem<Collectible>[] = [];

    // FS-required FA injection candidates
    if (selectedAction.school === "FS" && fsConstraint.status !== "FAIL") {
        // Reserve up to 2 FA keystones if available
        const faKeystones = fsConstraint.faKeystones.slice(0, 2);
        for (const c of faKeystones) {
            scored.push(
                scoreCollectible({
                    c,
                    label: "FS_required_fa",
                    action: selectedAction,
                    recencyIndex: 0,
                    playerFavIds: playerFav,
                })
            );
        }
    }

    // Pool B scores
    for (const c of poolB) {
        scored.push(
            scoreCollectible({
                c,
                label: "B_milestone",
                action: selectedAction,
                recencyIndex: 0,
                playerFavIds: playerFav,
            })
        );
    }

    // Pool A scores (recency index is position)
    for (let i = 0; i < poolA.length; i++) {
        scored.push(
            scoreCollectible({
                c: poolA[i],
                label: "A_recent",
                action: selectedAction,
                recencyIndex: i,
                playerFavIds: playerFav,
            })
        );
    }

    // Pool C scores
    for (const c of poolC) {
        scored.push(
            scoreCollectible({
                c,
                label: "C_wildcard",
                action: selectedAction,
                recencyIndex: 999,
                playerFavIds: playerFav,
            })
        );
    }

    // Merge + dedup
    let merged = uniqueBy(scored, (x) => x.item.id);

    // Sort by score
    merged = sortDesc(merged);

    // Constraint failure handling for FS:
    if (selectedAction.school === "FS" && fsConstraint.status === "FAIL") {
        // We cannot satisfy FS targets; return an empty-ish hand deterministically.
        // Upstream should replace FS in Action Hand or show a clear constraint note.
        return {
            snapshotId: snapshot.snapshotId,
            generatedAtMs: snapshot.generatedAtMs,
            targets: [],
            hardConstraints: [...hardConstraints, "No abstraction (FA) targets exist yet. Run an Abstraction action first."],
        };
    }

    // Enforce diversity:
    // - avoid all targets from the same runId
    // - avoid all same subtype
    const desired = DEFAULT_TARGETS_HAND_SIZE;

    // First pass: cap same run to 3 and same type to 3
    let diversified = diversifyBy(merged, 3, (x) => x.item.runId, desired + 2);
    diversified = diversifyBy(diversified, 3, (x) => x.item.type, desired + 2);

    // Final clamp 4–6
    const finalSize = clamp(desired, 4, 6);
    let final = diversified.slice(0, finalSize);

    // If too small, widen within available merged
    if (final.length < 4) {
        const fill = merged.filter((x) => !final.some((y) => y.item.id === x.item.id));
        for (const x of fill) {
            final.push(x);
            if (final.length >= 4) break;
        }
    }

    // Final guardrails:
    // - collectibles only (true by construction)
    // - allowed types (true by construction)
    // - dedup
    final = uniqueBy(final, (x) => x.item.id);
    final = sortDesc(final);

    // Ensure 4–6
    if (final.length > 6) final = final.slice(0, 6);

    // If FS, try to ensure at least 1 FA keystone appears if any exist
    if (selectedAction.school === "FS" && fsConstraint.status !== "FAIL") {
        const hasFA = final.some((x) => x.item.producedBySchool === "FA" && TARGETABLE_COLLECTIBLE_TYPES.keystones.has(x.item.type));
        if (!hasFA && fsConstraint.faKeystones.length > 0) {
            // Replace the lowest-scoring item with the best FA keystone
            const bestFA = fsConstraint.faKeystones[0];
            final.pop();
            final.push(
                scoreCollectible({
                    c: bestFA,
                    label: "FS_required_fa",
                    action: selectedAction,
                    recencyIndex: 0,
                    playerFavIds: playerFav,
                })
            );
            final = uniqueBy(sortDesc(final), (x) => x.item.id);
        }
    }

    return {
        snapshotId: snapshot.snapshotId,
        generatedAtMs: snapshot.generatedAtMs,
        targets: final,
        hardConstraints,
    };
}

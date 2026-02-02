// recommendation/actionCatalog.ts

import type { ActionDef, ActionId, GameStateForRecs, School } from "./types";
import { ADJACENCY_NEXT, MILESTONE_FIELD_TO_FP_ACTION } from "./constants";

/**
 * Thin wrapper around your Action catalog:
 * - deterministic indexing
 * - eligibility filtering
 * - adjacency helpers
 */

export interface ActionCatalogIndex {
    byId: Map<ActionId, ActionDef>;
    bySchool: Map<School, ActionDef[]>;
    all: ActionDef[];
}

export function indexActionCatalog(actions: ActionDef[]): ActionCatalogIndex {
    const byId = new Map<ActionId, ActionDef>();
    const bySchool = new Map<School, ActionDef[]>();

    for (const a of actions) {
        byId.set(a.id, a);
        const list = bySchool.get(a.school) ?? [];
        list.push(a);
        bySchool.set(a.school, list);
    }

    // Stable ordering inside each bucket (by id)
    for (const [school, list] of bySchool.entries()) {
        bySchool.set(
            school,
            [...list].sort((x, y) => x.id.localeCompare(y.id))
        );
    }

    const all = [...actions].sort((x, y) => x.id.localeCompare(y.id));
    return { byId, bySchool, all };
}

export function getAdjacencySchools(lastSchool?: School): School[] {
    if (!lastSchool) return [];
    return ADJACENCY_NEXT[lastSchool] ?? [];
}

/**
 * Determine if there exist FA-derived artifacts to justify recommending FS.
 * V1 rule: if any recent run had school=FA OR any collectible says producedBySchool=FA.
 */
export function hasFAArtifacts(state: GameStateForRecs): boolean {
    for (let i = state.runs.length - 1; i >= 0; i--) {
        const r = state.runs[i];
        if (r.school === "FA") return true;
        for (const c of r.collectibles) {
            if (c.producedBySchool === "FA") return true;
        }
    }
    return false;
}

/**
 * FP action ordering for FP_START / enrichment-first.
 * This matches your “milestone enrichment” intuition: define goal → fence scope → tripwires → done receipt.
 */
export function defaultFpSequence(): ActionId[] {
    return ["FP-01", "FP-02", "FP-08", "FP-10"];
}

/**
 * Given missing milestone fields, return the FP actions that can enrich those fields.
 */
export function fpActionsForMissingFields(missingFields: string[]): ActionId[] {
    const out: ActionId[] = [];
    for (const f of missingFields) {
        // best-effort mapping (MilestoneField string union lives elsewhere)
        const key = f as keyof typeof MILESTONE_FIELD_TO_FP_ACTION;
        const fp = MILESTONE_FIELD_TO_FP_ACTION[key];
        if (fp) out.push(fp);
    }
    // keep stable order using default sequence
    const seq = defaultFpSequence();
    return [...new Set(out)].sort((a, b) => seq.indexOf(a) - seq.indexOf(b));
}

/**
 * Eligibility filtering (deterministic).
 *
 * Philosophy:
 * - FP_START → almost always FP only
 * - ENRICH → FP missing ones are allowed + non-FP as variety/stability
 * - CHASE → avoid FP unless explicitly needed (enrichment).
 */
export function eligibleActionsForMode(params: {
    state: GameStateForRecs;
    catalog: ActionCatalogIndex;
    mode: "FP_START" | "ENRICH" | "CHASE";
    missingFpActionIds: ActionId[]; // derived from missing milestone fields (could be empty)
}): ActionDef[] {
    const { state, catalog, mode, missingFpActionIds } = params;
    const unavailable = state.unavailableActionIds ?? new Set<ActionId>();

    const all = catalog.all.filter((a) => !unavailable.has(a.id));

    if (mode === "FP_START") {
        return all.filter((a) => a.school === "FP");
    }

    if (mode === "ENRICH") {
        // allow everything, but FP is “allowed” and will be selected earlier by slot fill
        return all;
    }

    // CHASE
    // Allow FP only if missing fields suggests it (rare); otherwise suppress FP.
    const allowFp = new Set(missingFpActionIds);
    return all.filter((a) => a.school !== "FP" || allowFp.has(a.id));
}

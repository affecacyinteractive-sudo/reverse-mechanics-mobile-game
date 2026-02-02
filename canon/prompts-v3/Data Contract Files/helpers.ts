/* Reverse Mechanics – small helpers (no deps) */

import type { ActionId, TargetId, MilestoneId, ProjectionRef, PromptCard } from "./contracts";

/** Stable fingerprint for a prompt card loadout */
export function makeFingerprint(input: {
    action_id: ActionId;
    target_ids: TargetId[];
    milestone_id?: MilestoneId;
}): string {
    const targets = [...input.target_ids].sort().join(",");
    const milestone = input.milestone_id ? input.milestone_id : "";
    return `${input.action_id}|${targets}|${milestone}`;
}

function projectionRefKey(r: ProjectionRef): string {
    return r.ns === "CODEBASE" ? `C:${r.entity_key}` : `I:${r.issue_key}`;
}

function projectionRefSortKey(r: ProjectionRef): string {
    // ns order: CODEBASE first, then ISSUE.
    const nsRank = r.ns === "CODEBASE" ? "0" : "1";
    const key = r.ns === "CODEBASE" ? r.entity_key : r.issue_key;
    return `${nsRank}|${key}`;
}

/** Dedupe projection refs (first occurrence wins) */
export function dedupeProjectionRefs(refs: ProjectionRef[]): ProjectionRef[] {
    const seen = new Set<string>();
    const out: ProjectionRef[] = [];
    for (const r of refs) {
        const key = projectionRefKey(r);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(r);
        }
    }
    return out;
}

/** Canonicalize refs for stable persistence (dedupe + sort) */
export function canonicalizeProjectionRefs(refs: ProjectionRef[]): ProjectionRef[] {
    return dedupeProjectionRefs(refs).sort((a, b) => {
        const ka = projectionRefSortKey(a);
        const kb = projectionRefSortKey(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

export function projectionRefsEqual(a: ProjectionRef[], b: ProjectionRef[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (x.ns !== y.ns) return false;
        if (x.ns === "CODEBASE") {
            if (x.entity_key !== (y as any).entity_key) return false;
        } else {
            if (x.issue_key !== (y as any).issue_key) return false;
        }
    }
    return true;
}

/**
 * Refresh a prompt card's slice refs against the current projection inventory.
 * - Drops missing refs.
 * - Canonicalizes (dedupe + sort) to avoid positional churn.
 * - Bumps slice_version if anything changed.
 */
export function refreshPromptCardSlice(input: {
    promptCard: PromptCard;
    availableCodebaseKeys: Set<string>;
    availableIssueKeys: Set<string>;
}): PromptCard {
    const beforeCanon = canonicalizeProjectionRefs(input.promptCard.selected_projection_refs);

    const filtered = beforeCanon.filter((r) => {
        if (r.ns === "CODEBASE") return input.availableCodebaseKeys.has(r.entity_key);
        return input.availableIssueKeys.has(r.issue_key);
    });

    const afterCanon = canonicalizeProjectionRefs(filtered);

    const changed = !projectionRefsEqual(beforeCanon, afterCanon);
    if (!changed) {
        // Still persist canonical order if caller had a non-canonical array (rare but possible).
        if (!projectionRefsEqual(input.promptCard.selected_projection_refs, beforeCanon)) {
            return { ...input.promptCard, selected_projection_refs: beforeCanon };
        }
        return input.promptCard;
    }

    return {
        ...input.promptCard,
        selected_projection_refs: afterCanon,
        slice_version: input.promptCard.slice_version + 1,
    };
}

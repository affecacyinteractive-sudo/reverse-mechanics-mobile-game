// rcpt-anchor.ts
// Deterministic post-commit receipt: ANCHOR
// Builds a single TEXT Chunk that tells the player where committed code landed
// (file/entity + line range), using patchsegment→entity mappings + INDEX locators.

import crypto from "node:crypto";
import type {
    Chunk,
    EntityKey,
    IndexEntity,
    PatchSegment,
    ProjectId,
    RunId,
} from "./types-2";

export interface IndexStore {
    /** Locator lookup at a run boundary (recommended). */
    getEntityAtOrBeforeRun(args: {
        project_id: ProjectId;
        entity_key: EntityKey;
        at_run_id: RunId;
    }): Promise<IndexEntity | null>;
}

export type RcptAnchorResult =
    | { ok: true; anchor: Chunk; seals: [] }
    | { ok: false; anchor: null; seals: [Chunk] };

function uuid() {
    return crypto.randomUUID();
}

function makeSeal(title: string, body: string): Chunk {
    return { id: `seal_${uuid()}`, kind: "TEXT", title, body };
}

function basename(p: string) {
    const parts = p.split("/");
    return parts[parts.length - 1] ?? p;
}

function words(s: string) {
    return s.trim().split(/\s+/).filter(Boolean).length;
}

function uniq<T>(xs: T[]): T[] {
    return [...new Set(xs)];
}

function collectKeys(ps: PatchSegment): { created: EntityKey[]; touched: EntityKey[] } {
    const created = ps.entity_keys_created ?? [];
    const touched = uniq([...(ps.entity_keys_touched ?? []), ...created]);

    // If commit-lock isn't present yet but explicit target is, use it.
    if (!touched.length && ps.write_targets?.entity_key) {
        return { created: [], touched: [ps.write_targets.entity_key] };
    }

    return { created, touched };
}

function fmtEntity(ent: IndexEntity): string | null {
    const loc = ent.latest_locator;
    if (!loc) return null;
    const name = ent.entity_name || ent.entity_key.split("::")[1] || "entity";
    return `${basename(ent.file_path)}::${name} (L${loc.start_line}–${loc.end_line})`;
}

function truncTitle(s: string, max = 25) {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
}

function joinList(items: string[]): string {
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items[0]}, ${items[1]}, and ${items.length - 2} more`;
}

export async function rcptAnchor(args: {
    project_id: ProjectId;
    commit_run_id: RunId;
    patch_segments: PatchSegment[];
    index: IndexStore;

    /** Display caps to keep the chunk small. */
    max_show_created?: number; // default 2
    max_show_updated?: number; // default 2
}): Promise<RcptAnchorResult> {
    const {
        project_id,
        commit_run_id,
        patch_segments,
        index,
        max_show_created = 2,
        max_show_updated = 2,
    } = args;

    if (!patch_segments?.length) {
        return {
            ok: false,
            anchor: null,
            seals: [
                makeSeal(
                    "ANCHOR_UNUSABLE",
                    "Anchor receipt skipped: no patch segments were provided. Commit must include patch segments (or their locked entity mappings) so we can locate the exact code surfaces."
                ),
            ],
        };
    }

    // 1) Collect entity keys from patch segments (commit-locked mapping preferred)
    const createdKeys: EntityKey[] = [];
    const touchedKeys: EntityKey[] = [];

    for (const ps of patch_segments) {
        const { created, touched } = collectKeys(ps);
        createdKeys.push(...created);
        touchedKeys.push(...touched);
    }

    const createdSet = new Set<EntityKey>(createdKeys);
    const touchedSet = new Set<EntityKey>(touchedKeys);

    // If nothing was locked, we can't anchor deterministically.
    if (touchedSet.size === 0) {
        return {
            ok: false,
            anchor: null,
            seals: [
                makeSeal(
                    "ANCHOR_UNUSABLE",
                    "Anchor receipt skipped: patch segments have no locked entity mappings. Run PATCHSEGMENT→ENTITY LOCK after commit (and index refresh) so patch segments can resolve to exact entity locations."
                ),
            ],
        };
    }

    // 2) Resolve locators from INDEX (at commit boundary)
    const createdResolved: string[] = [];
    const updatedResolved: string[] = [];

    const touchedSorted = [...touchedSet].sort();
    for (const ek of touchedSorted) {
        const ent = await index.getEntityAtOrBeforeRun({
            project_id,
            entity_key: ek,
            at_run_id: commit_run_id,
        });

        if (!ent || ent.status !== "ACTIVE" || !ent.latest_locator) continue;

        const s = fmtEntity(ent);
        if (!s) continue;

        if (createdSet.has(ek)) createdResolved.push(s);
        else updatedResolved.push(s);
    }

    if (createdResolved.length === 0 && updatedResolved.length === 0) {
        return {
            ok: false,
            anchor: null,
            seals: [
                makeSeal(
                    "ANCHOR_UNUSABLE",
                    "Anchor receipt skipped: no ACTIVE entity locators were found for the committed surfaces. Ensure CODE-INDEX-REFRESH ran after CODE-APPEND and that entities have sentinel-bounded locators."
                ),
            ],
        };
    }

    // 3) Build compact chunk-sized receipt
    const showCreated = createdResolved.slice(0, max_show_created);
    const showUpdated = updatedResolved.slice(0, max_show_updated);

    const createdMore = Math.max(0, createdResolved.length - showCreated.length);
    const updatedMore = Math.max(0, updatedResolved.length - showUpdated.length);

    const titleBase =
        showCreated[0] || showUpdated[0] || "ANCHOR";
    const titleFile = titleBase.includes("::") ? titleBase.split("::")[0] : "ANCHOR";
    const title = truncTitle(`ANCHOR — ${titleFile}`);

    let s1 = "";
    let s2 = "";

    if (showCreated.length) {
        s1 = `Added ${joinList(showCreated)}.`;
        if (showUpdated.length) s2 = `Also updated ${joinList(showUpdated)}.`;
    } else {
        s1 = `Updated ${joinList(showUpdated)}.`;
    }

    const extraCount = createdMore + updatedMore;
    if (extraCount > 0) {
        // Append a non-invasive count note to the second sentence (or create it if empty)
        const extraNote = `Touched ${extraCount} more entity${extraCount === 1 ? "" : "ies"}.`;
        if (s2) s2 = `${s2} ${extraNote}`;
        else s2 = extraNote;
    }

    let body = s2 ? `${s1}\n${s2}` : s1;

    // Enforce chunk-ish size (20–60 words): pad minimally if too short.
    if (words(body) < 20) {
        body = `${body}\nAnchors reflect the exact committed surfaces for this run.`;
    }

    // If somehow too long, drop the second sentence first.
    if (words(body) > 60 && s2) {
        body = s1;
    }

    const anchor: Chunk = {
        id: `anchor_${uuid()}`,
        kind: "TEXT",
        title,
        body,
    };

    return { ok: true, anchor, seals: [] };
}
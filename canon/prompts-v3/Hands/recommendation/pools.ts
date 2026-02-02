// recommendation/pools.ts

import type { HandItem } from "./types";

/**
 * Deterministic tiny hash for stable ordering and variety without true randomness.
 */
export function stableHash(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function seededSort<T>(items: T[], seedKey: string, keyFn: (x: T) => string): T[] {
    const seed = stableHash(seedKey);
    return [...items].sort((a, b) => {
        const ha = stableHash(keyFn(a)) ^ seed;
        const hb = stableHash(keyFn(b)) ^ seed;
        return ha - hb;
    });
}

export function uniqueBy<T>(items: T[], keyFn: (x: T) => string): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const x of items) {
        const k = keyFn(x);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(x);
    }
    return out;
}

export function takeTopN<T>(items: T[], n: number): T[] {
    return items.slice(0, Math.max(0, n));
}

export function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

export function scoreRecency(ageIndex: number): number {
    // ageIndex = 0 means newest
    // quick drop-off; tweak later
    return 1.0 / (1.0 + ageIndex);
}

/**
 * Enforce “not all from the same bucket” without overthinking.
 * Example buckets: runId, subtype, school.
 */
export function diversifyBy<T>(
    items: T[],
    maxSameBucket: number,
    bucketKey: (x: T) => string,
    limit: number
): T[] {
    const counts = new Map<string, number>();
    const out: T[] = [];

    for (const x of items) {
        if (out.length >= limit) break;
        const k = bucketKey(x);
        const c = counts.get(k) ?? 0;
        if (c >= maxSameBucket) continue;
        counts.set(k, c + 1);
        out.push(x);
    }

    return out;
}

export function sortHandItemsDesc<T>(items: HandItem<T>[]): HandItem<T>[] {
    return [...items].sort((a, b) => b.score - a.score);
}

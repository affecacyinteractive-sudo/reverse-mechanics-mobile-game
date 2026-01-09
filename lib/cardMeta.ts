export type CardMeta = {
    id: string;
    kind: "ACTION" | "PROMPT" | "OUTPUT";
    anchor: string;
    domain: "SOFTWARE" | "STORY" | "NONE";
    canonId: string | null;
    meta: any;
};

export async function fetchCardMeta(ids: string[]): Promise<Record<string, CardMeta>> {
    const clean = Array.from(new Set(ids)).filter(Boolean);
    if (clean.length === 0) return {};

    const res = await fetch(`/api/cards?ids=${encodeURIComponent(clean.join(","))}`, {
        cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to load card meta");

    const data = (await res.json()) as { cards: CardMeta[] };
    const map: Record<string, CardMeta> = {};
    for (const c of data.cards) map[c.id] = c;
    return map;
}

export const isAction = (c?: CardMeta) => c?.kind === "ACTION";
export const isPrompt = (c?: CardMeta) => c?.kind === "PROMPT";
export const isOutput = (c?: CardMeta) => c?.kind === "OUTPUT";

export function isExecutionPrompt(c?: CardMeta) {
    if (!c) return false;
    if (c.kind !== "PROMPT") return false;
    const t = c.meta?.prompt_type ?? "EXECUTION"; // v1 default
    return t === "EXECUTION";
}

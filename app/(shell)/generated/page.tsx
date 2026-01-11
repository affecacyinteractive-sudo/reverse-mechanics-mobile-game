"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import MobileContainer from "@/components/MobileContainer";
import DeckRow from "@/components/DeckRow";
import { CardTile } from "@/components/CardTile";
import CardDetailsSheet from "@/components/CardDetailsSheet";

type GeneratedCard = {
    id: string;
    kind: "OUTPUT";
    zone: "GENERATED";
    domain: "SOFTWARE" | "STORY" | "NONE";
    canonId: string | null;
    anchor: string;
    body: string;
    meta: any;
    isCommitted: boolean;
};

type GeneratedDeck = {
    id: string;
    title: string;
    createdAt: string;
    cards: GeneratedCard[];
};

async function fetchGenerated(): Promise<{ decks: GeneratedDeck[] }> {
    const res = await fetch("/api/generated", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load generated decks");
    return res.json();
}

function preview(text: string, n = 120) {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
}

function chunkBadge(meta: any) {
    const t = meta?.chunk_type;
    if (t === "code") return "CODE";
    if (t === "text") return "TEXT";
    return null;
}

async function setCardCommitted(cardId: string, committed: boolean) {
    const res = await fetch("/api/commit/card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId, committed }),
    });
    if (!res.ok) throw new Error("Commit failed");
}

async function setDeckCommitted(deckId: string, committed: boolean) {
    const res = await fetch("/api/commit/deck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deckId, committed }),
    });
    if (!res.ok) throw new Error("Commit deck failed");
}

export default function GeneratedPage() {
    const qc = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: ["generated"],
        queryFn: fetchGenerated,
    });

    const [open, setOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const allCards = useMemo(() => {
        const decks = data?.decks ?? [];
        const map = new Map<string, GeneratedCard>();
        for (const d of decks) for (const c of d.cards) map.set(c.id, c);
        return map;
    }, [data?.decks]);

    const selectedCard = useMemo(() => {
        if (!selectedId) return null;
        const c = allCards.get(selectedId);
        return c
            ? { id: c.id, anchor: c.anchor, body: c.body, isDraft: false, isCommitted: c.isCommitted }
            : null;
    }, [selectedId, allCards]);

    return (
        <MobileContainer>
            <div className="text-lg font-semibold">Generated</div>
            <div className="mt-1 text-sm opacity-70">
                Output cards live here. Add them to Hand to use as Targets. Commit them to include in evolving story context.
            </div>

            {isLoading && <div className="mt-3 text-sm opacity-70">Loading…</div>}
            {error && <div className="mt-3 text-sm text-red-600">Failed to load.</div>}

            <div className="mt-4 space-y-6">
                {(data?.decks ?? []).map((d) => {
                    const allCommitted = d.cards.length > 0 && d.cards.every((c) => c.isCommitted);

                    return (
                        <section key={d.id} className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-semibold truncate">{d.title}</div>
                                    <div className="text-xs opacity-60">{d.cards.length} cards</div>
                                </div>

                                <button
                                    className="shrink-0 rounded-full border px-3 py-1 text-sm"
                                    disabled={d.cards.length === 0}
                                    onClick={async () => {
                                        await setDeckCommitted(d.id, !allCommitted);
                                        await qc.invalidateQueries({ queryKey: ["generated"] });
                                    }}
                                    title="Commit/uncommit all cards in this deck"
                                >
                                    {allCommitted ? "Uncommit Deck" : "Commit Deck"}
                                </button>
                            </div>

                            <DeckRow>
                                {d.cards.map((c) => {
                                    const badges: string[] = [];
                                    if (c.isCommitted) badges.push("COMMITTED");
                                    const cb = chunkBadge(c.meta);
                                    if (cb) badges.push(cb);

                                    return (
                                        <div key={c.id} className="w-64 shrink-0 snap-start">
                                            <div className="mb-1 text-[11px] opacity-60">
                                                {badges.length ? `• ${badges.join(" • ")}` : "\u00A0"}
                                            </div>

                                            <CardTile
                                                id={c.id}
                                                anchor={c.anchor}
                                                bodyPreview={preview(c.body)}
                                                isDraft={false}
                                                onOpenDetails={(cardId) => {
                                                    setSelectedId(cardId);
                                                    setOpen(true);
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </DeckRow>
                        </section>
                    );
                })}
            </div>

            <CardDetailsSheet
                open={open}
                onOpenChange={setOpen}
                card={selectedCard}
                showCommit
                onCommitToggle={async (nextCommitted, cardId) => {
                    await setCardCommitted(cardId, nextCommitted);
                    await qc.invalidateQueries({ queryKey: ["generated"] });
                }}
            />
        </MobileContainer>
    );
}

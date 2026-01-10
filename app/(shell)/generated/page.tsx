// app/(shell)/generated/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

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

function badge(meta: any) {
    const t = meta?.chunk_type;
    if (t === "code") return "CODE";
    if (t === "text") return "TEXT";
    return null;
}

export default function GeneratedPage() {
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
        // Generated cards are never drafts
        return c ? { id: c.id, anchor: c.anchor, body: c.body, isDraft: false } : null;
    }, [selectedId, allCards]);

    return (
        <MobileContainer>
            <div className="text-lg font-semibold">Generated</div>
            <div className="mt-1 text-sm opacity-70">
                Output cards live here. Add them to Hand to use as Targets.
            </div>

            {isLoading && <div className="mt-3 text-sm opacity-70">Loading…</div>}
            {error && <div className="mt-3 text-sm text-red-600">Failed to load.</div>}

            <div className="mt-4 space-y-6">
                {(data?.decks ?? []).map((d) => (
                    <section key={d.id} className="space-y-2">
                        <div className="flex items-baseline justify-between">
                            <div className="font-semibold">{d.title}</div>
                            <div className="text-xs opacity-60">{d.cards.length} cards</div>
                        </div>

                        <DeckRow>
                            {d.cards.map((c) => (
                                <div key={c.id} className="w-64 shrink-0 snap-start">
                                    <div className="mb-1 text-[11px] opacity-60">
                                        {badge(c.meta) ? `• ${badge(c.meta)}` : "\u00A0"}
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
                            ))}
                        </DeckRow>
                    </section>
                ))}
            </div>

            <CardDetailsSheet open={open} onOpenChange={setOpen} card={selectedCard} />
        </MobileContainer>
    );
}

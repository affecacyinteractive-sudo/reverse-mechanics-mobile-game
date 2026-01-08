"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import MobileContainer from "@/components/MobileContainer";
import { CardTile } from "@/components/CardTile";
import CardDetailsSheet from "@/components/CardDetailsSheet";

type LibraryCard = {
    id: string;
    kind: "ACTION" | "PROMPT" | "OUTPUT";
    zone: "LIBRARY" | "GENERATED" | "WORKSHOP";
    domain: "SOFTWARE" | "STORY" | "NONE";
    canonId: string | null;
    schoolCode: string | null;
    schoolName: string | null;
    anchor: string;
    body: string;
};

async function fetchLibrary(): Promise<{ cards: LibraryCard[] }> {
    const res = await fetch("/api/library", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load library");
    return res.json();
}

function preview(text: string, n = 140) {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
}

export default function LibraryPage() {
    const [open, setOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ["library"],
        queryFn: fetchLibrary,
    });

    const selectedCard = useMemo(() => {
        if (!selectedId || !data?.cards) return null;
        const c = data.cards.find((x) => x.id === selectedId);
        return c ? { id: c.id, anchor: c.anchor, body: c.body } : null;
    }, [selectedId, data?.cards]);

    return (
        <MobileContainer>
            <div className="text-lg font-semibold">Library</div>

            {isLoading && <div className="mt-3 text-sm opacity-70">Loading…</div>}
            {error && <div className="mt-3 text-sm text-red-600">Failed to load.</div>}

            <div className="mt-3 space-y-3">
                {(data?.cards ?? []).map((c) => (
                    <CardTile
                        key={c.id}
                        id={c.id}
                        anchor={c.anchor}
                        bodyPreview={preview(c.body)}
                        onOpenDetails={(cardId) => {
                            setSelectedId(cardId);
                            setOpen(true);
                        }}
                    />
                ))}
            </div>

            <CardDetailsSheet open={open} onOpenChange={setOpen} card={selectedCard} />
        </MobileContainer>
    );
}

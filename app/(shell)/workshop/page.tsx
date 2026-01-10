"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import MobileContainer from "@/components/MobileContainer";
import WorkshopEditorSheet from "@/components/WorkshopEditorSheet";
import { useHandStore } from "@/store/handStore";
import { fetchCardMeta, CardMeta } from "@/lib/cardMeta";

type Tab = "HAND" | "DRAFTS" | "MINE";

type WorkshopCard = {
    id: string;
    kind: "PROMPT" | "OUTPUT";
    zone: "LIBRARY" | "GENERATED" | "WORKSHOP";
    domain: "SOFTWARE" | "STORY" | "NONE";
    canonId: string | null;
    anchor: string;
    body: string;
    meta: any;
    isDraft: boolean;
    isCommitted: boolean;
    isImmutable: boolean;
    createdAt?: string;
};

async function fetchDrafts(): Promise<{ drafts: WorkshopCard[]; sessionId: string | null }> {
    const res = await fetch("/api/workshop/drafts", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load drafts");
    return res.json();
}

async function fetchMine(): Promise<{ cards: WorkshopCard[]; sessionId: string | null }> {
    const res = await fetch("/api/workshop/mine", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load my cards");
    return res.json();
}

async function fetchWorkshopCard(id: string): Promise<WorkshopCard> {
    const res = await fetch(`/api/workshop/cards/${id}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load card");
    const data = await res.json();
    return data.card as WorkshopCard;
}

function preview(s: string, n = 120) {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
}

function TabToggle(props: { value: Tab; onChange: (v: Tab) => void }) {
    const btn = (v: Tab, label: string) => (
        <button
            onClick={() => props.onChange(v)}
            className={[
                "flex-1 rounded-full border px-3 py-2 text-sm",
                props.value === v ? "font-semibold" : "opacity-70",
            ].join(" ")}
        >
            {label}
        </button>
    );

    return (
        <div className="mt-3 flex gap-2">
            {btn("HAND", "In Hand")}
            {btn("DRAFTS", "Drafts")}
            {btn("MINE", "My Cards")}
        </div>
    );
}

function BadgePill({ children }: { children: React.ReactNode }) {
    return <span className="rounded-full border px-2 py-0.5 text-[11px] opacity-70">{children}</span>;
}

export default function WorkshopPage() {
    const qc = useQueryClient();
    const [tab, setTab] = useState<Tab>("HAND");

    // editor state
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorKind, setEditorKind] = useState<"OUTPUT" | "PROMPT">("OUTPUT");
    const [editing, setEditing] = useState<WorkshopCard | null>(null);

    // Hand state
    const handItems = useHandStore((s) => s.items);
    const toggleHand = useHandStore((s) => s.toggle);
    const removeFromHand = useHandStore((s) => s.remove);

    const handCardIds = useMemo(() => {
        return handItems.filter((x: any) => x.kind === "card").map((x: any) => x.id);
    }, [handItems]);

    const handIdSet = useMemo(() => new Set(handCardIds), [handCardIds]);
    const inHand = (id: string) => handIdSet.has(id);

    // Load meta for cards in hand (for In Hand tab)
    const { data: handMetaMap = {}, isLoading: handLoading } = useQuery({
        queryKey: ["workshop-hand-meta", handCardIds.slice().sort().join(",")],
        queryFn: () => fetchCardMeta(handCardIds),
        enabled: tab === "HAND" && handCardIds.length > 0,
        retry: 0,
        refetchOnWindowFocus: false,
    });

    const editableHandCards = useMemo(() => {
        const metas = Object.values(handMetaMap) as CardMeta[];
        return metas
            .filter((m) => (m.kind === "PROMPT" || m.kind === "OUTPUT") && !m.isDraft)
            .sort((a, b) => a.anchor.localeCompare(b.anchor));
    }, [handMetaMap]);

    // Drafts tab
    const { data: draftsData, isLoading: draftsLoading } = useQuery({
        queryKey: ["workshop-drafts"],
        queryFn: fetchDrafts,
        enabled: tab === "DRAFTS",
        retry: 0,
        refetchOnWindowFocus: false,
    });
    const drafts = (draftsData?.drafts ?? []).filter((d) => d.kind === "OUTPUT" || d.kind === "PROMPT");

    // My Cards tab (non-draft workshop)
    const { data: mineData, isLoading: mineLoading } = useQuery({
        queryKey: ["workshop-mine"],
        queryFn: fetchMine,
        enabled: tab === "MINE",
        retry: 0,
        refetchOnWindowFocus: false,
    });
    const mine = (mineData?.cards ?? []).filter((c) => c.kind === "OUTPUT" || c.kind === "PROMPT");

    // Create draft copy from any card id (PROMPT/OUTPUT only)
    const copyToDraft = useMutation({
        mutationFn: async (sourceId: string) => {
            const res = await fetch("/api/workshop/cards/copy", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sourceId }),
            });
            if (!res.ok) throw new Error("Copy failed");
            return (await res.json()) as { id: string };
        },
        onSuccess: async ({ id }) => {
            setTab("DRAFTS");
            await qc.invalidateQueries({ queryKey: ["workshop-drafts"] });

            const card = await fetchWorkshopCard(id);
            setEditorKind(card.kind);
            setEditing(card);
            setEditorOpen(true);
        },
    });

    const undraft = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/workshop/cards/${id}/undraft`, { method: "POST" });
            if (!res.ok) throw new Error("Undraft failed");
            return res.json();
        },
        onSuccess: async (_data, id) => {
            // card becomes usable; add to hand (v1 convenience)
            if (!inHand(id)) toggleHand({ kind: "card", id } as any);

            await qc.invalidateQueries({ queryKey: ["workshop-drafts"] });
            await qc.invalidateQueries({ queryKey: ["workshop-mine"] });
            setTab("MINE");
        },
    });

    const deleteCard = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/workshop/cards/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Delete failed");
        },
        onSuccess: async (_data, id) => {
            // cleanup: if it was in hand, remove it
            if (inHand(id)) removeFromHand({ kind: "card", id } as any);

            await qc.invalidateQueries({ queryKey: ["workshop-drafts"] });
            await qc.invalidateQueries({ queryKey: ["workshop-mine"] });
            await qc.invalidateQueries({ queryKey: ["workshop-hand-meta"] });
        },
    });

    return (
        <MobileContainer>
            <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Workshop</div>

                <div className="flex gap-2">
                    <button
                        className="rounded-full border px-3 py-2 text-sm"
                        onClick={() => {
                            setEditorKind("OUTPUT");
                            setEditing(null);
                            setEditorOpen(true);
                            setTab("DRAFTS"); // creations start as drafts
                        }}
                    >
                        New Output
                    </button>
                    <button
                        className="rounded-full border px-3 py-2 text-sm"
                        onClick={() => {
                            setEditorKind("PROMPT");
                            setEditing(null);
                            setEditorOpen(true);
                            setTab("DRAFTS");
                        }}
                    >
                        New Prompt
                    </button>
                </div>
            </div>

            <TabToggle value={tab} onChange={setTab} />

            {tab === "HAND" ? (
                <div className="mt-4 space-y-3">
                    {handLoading ? <div className="text-sm opacity-70">Loading…</div> : null}

                    {editableHandCards.map((m) => (
                        <div key={m.id} className="rounded-2xl border p-4 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-semibold">{m.anchor}</div>
                                    <div className="mt-1 flex gap-2 flex-wrap">
                                        <BadgePill>{m.kind}</BadgePill>
                                        <BadgePill>{m.domain}</BadgePill>
                                    </div>
                                </div>

                                <button
                                    className="shrink-0 rounded-full border px-3 py-2 text-sm"
                                    onClick={() => copyToDraft.mutate(m.id)}
                                    disabled={copyToDraft.isPending}
                                    title="Edit creates a Draft copy"
                                >
                                    Edit
                                </button>
                            </div>

                            <div className="text-sm opacity-70">Edit creates a Draft copy. Drafts are not playable.</div>
                        </div>
                    ))}

                    {!handLoading && editableHandCards.length === 0 ? (
                        <div className="text-sm opacity-70">
                            No editable cards in hand. Add OUTPUT or PROMPT cards to Hand first.
                        </div>
                    ) : null}
                </div>
            ) : null}

            {tab === "DRAFTS" ? (
                <div className="mt-4 space-y-3">
                    {draftsLoading ? <div className="text-sm opacity-70">Loading…</div> : null}

                    {drafts.map((c) => (
                        <div key={c.id} className="rounded-2xl border p-4 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-semibold">{c.anchor}</div>
                                    <div className="mt-1 flex gap-2 flex-wrap items-center">
                                        <BadgePill>Draft</BadgePill>
                                        <BadgePill>{c.kind}</BadgePill>
                                        <BadgePill>{c.domain}</BadgePill>
                                    </div>
                                </div>
                            </div>

                            <div className="text-sm opacity-80 line-clamp-3">{preview(c.body)}</div>

                            <div className="flex gap-2 flex-wrap pt-1">
                                <button
                                    className="rounded-full border px-3 py-1 text-sm opacity-80"
                                    onClick={() => {
                                        setEditorKind(c.kind);
                                        setEditing(c);
                                        setEditorOpen(true);
                                    }}
                                >
                                    Edit
                                </button>

                                <button
                                    className="rounded-full border px-3 py-1 text-sm opacity-80"
                                    onClick={() => undraft.mutate(c.id)}
                                    disabled={undraft.isPending}
                                    title="Remove Draft. Card becomes usable."
                                >
                                    Remove Draft
                                </button>

                                <button
                                    className="rounded-full border px-3 py-1 text-sm text-red-600"
                                    onClick={() => {
                                        if (confirm("Delete this draft?")) deleteCard.mutate(c.id);
                                    }}
                                    disabled={deleteCard.isPending}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}

                    {!draftsLoading && drafts.length === 0 ? (
                        <div className="text-sm opacity-70">No drafts yet.</div>
                    ) : null}
                </div>
            ) : null}

            {tab === "MINE" ? (
                <div className="mt-4 space-y-3">
                    {mineLoading ? <div className="text-sm opacity-70">Loading…</div> : null}

                    {mine.map((c) => (
                        <div key={c.id} className="rounded-2xl border p-4 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-semibold">{c.anchor}</div>
                                    <div className="mt-1 flex gap-2 flex-wrap items-center">
                                        <BadgePill>{c.kind}</BadgePill>
                                        <BadgePill>{c.domain}</BadgePill>
                                        {c.isCommitted ? <BadgePill>Committed</BadgePill> : null}
                                        {inHand(c.id) ? <BadgePill>In Hand</BadgePill> : null}
                                    </div>
                                </div>
                            </div>

                            <div className="text-sm opacity-80 line-clamp-3">{preview(c.body)}</div>

                            <div className="flex gap-2 flex-wrap pt-1">
                                <button
                                    className="rounded-full border px-3 py-1 text-sm opacity-80"
                                    onClick={() => copyToDraft.mutate(c.id)}
                                    disabled={copyToDraft.isPending}
                                    title="Edit creates a Draft copy"
                                >
                                    Edit
                                </button>

                                <button
                                    className="rounded-full border px-3 py-1 text-sm text-red-600"
                                    onClick={() => {
                                        if (confirm("Delete this card?")) deleteCard.mutate(c.id);
                                    }}
                                    disabled={deleteCard.isPending}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}

                    {!mineLoading && mine.length === 0 ? (
                        <div className="text-sm opacity-70">No workshop cards yet. Undraft a draft to make it usable.</div>
                    ) : null}
                </div>
            ) : null}

            <WorkshopEditorSheet
                open={editorOpen}
                onOpenChange={setEditorOpen}
                kind={editorKind}
                editing={editing}
                onSaved={async () => {
                    await qc.invalidateQueries({ queryKey: ["workshop-drafts"] });
                    await qc.invalidateQueries({ queryKey: ["workshop-mine"] });
                }}
            />
        </MobileContainer>
    );
}

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import MobileContainer from "@/components/MobileContainer";
import { Button } from "@/components/ui/button";

type ContextResp = {
    sessionId: string;
    maxCards: number;
    maxChars: number;
    usedChars: number;
    chunksIncluded: number;
    hash: string;
    sources: Array<{ id: string; anchor: string; domain: "SOFTWARE" | "STORY" | "NONE"; createdAt: string }>;
    context: string;
};

async function fetchContext(maxCards: number, maxChars: number): Promise<ContextResp> {
    const res = await fetch(`/api/context?maxCards=${maxCards}&maxChars=${maxChars}`, {
        cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to load context");
    return res.json();
}

export default function ContextPage() {
    const [maxCards, setMaxCards] = useState(60);
    const [maxChars, setMaxChars] = useState(20000);
    const [showSources, setShowSources] = useState(false);

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["context", maxCards, maxChars],
        queryFn: () => fetchContext(maxCards, maxChars),
    });

    const stats = useMemo(() => {
        if (!data) return null;
        return `${data.chunksIncluded} chunks • ${data.usedChars}/${data.maxChars} chars`;
    }, [data]);

    return (
        <MobileContainer>
            <div className="text-lg font-semibold">Context</div>
            <div className="mt-1 text-sm opacity-70">
                This is the exact stitched context that will be fed into the model on Run.
            </div>

            <div className="mt-4 flex items-center gap-2">
                <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
                    {isFetching ? "Refreshing…" : "Refresh"}
                </Button>

                <Button
                    variant="secondary"
                    onClick={async () => {
                        const text = data?.context ?? "";
                        await navigator.clipboard.writeText(text);
                    }}
                    disabled={!data?.context}
                >
                    Copy
                </Button>

                <Button variant="secondary" onClick={() => setShowSources((s) => !s)} disabled={!data}>
                    {showSources ? "Hide Sources" : "Show Sources"}
                </Button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
                <label className="text-xs opacity-70">
                    Max cards
                    <input
                        type="number"
                        value={maxCards}
                        min={1}
                        max={300}
                        onChange={(e) => setMaxCards(Number(e.target.value || 60))}
                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    />
                </label>

                <label className="text-xs opacity-70">
                    Max chars
                    <input
                        type="number"
                        value={maxChars}
                        min={500}
                        max={200000}
                        onChange={(e) => setMaxChars(Number(e.target.value || 20000))}
                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    />
                </label>
            </div>

            <div className="mt-3 text-sm">
                {isLoading ? <span className="opacity-70">Loading…</span> : null}
                {error ? <span className="text-red-600">Failed to load.</span> : null}
                {data ? (
                    <div className="space-y-1">
                        <div className="text-xs opacity-70">{stats}</div>
                        <div className="text-xs opacity-70 break-all">hash: {data.hash}</div>
                    </div>
                ) : null}
            </div>

            {showSources && data ? (
                <div className="mt-4 rounded-xl border p-3">
                    <div className="text-sm font-semibold">Included cards</div>
                    <div className="mt-2 space-y-2">
                        {data.sources.map((s) => (
                            <div key={s.id} className="text-xs">
                                <div className="font-medium">
                                    {s.anchor} <span className="opacity-60">({s.domain})</span>
                                </div>
                                <div className="opacity-60 break-all">{s.id}</div>
                            </div>
                        ))}
                        {data.sources.length === 0 ? <div className="text-xs opacity-60">None committed yet.</div> : null}
                    </div>
                </div>
            ) : null}

            <div className="mt-4 rounded-xl border">
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed">
          {data?.context ?? ""}
        </pre>
            </div>
        </MobileContainer>
    );
}

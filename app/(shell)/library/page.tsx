// app/(shell)/library/page.tsx
"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import MobileContainer from "@/components/MobileContainer";
import { CardTile } from "@/components/CardTile";
import CardDetailsSheet from "@/components/CardDetailsSheet";

type Domain = "SOFTWARE" | "STORY";

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

function ModeToggle(props: {
    value: "ACTIONS" | "PROMPTS";
    onChange: (v: "ACTIONS" | "PROMPTS") => void;
}) {
    const btn = (v: "ACTIONS" | "PROMPTS", label: string) => (
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
            {btn("ACTIONS", "Actions")}
            {btn("PROMPTS", "Prompts")}
        </div>
    );
}

function DomainToggle(props: { value: Domain; onChange: (d: Domain) => void }) {
    const btn = (d: Domain, label: string) => (
        <button
            onClick={() => props.onChange(d)}
            className={[
                "flex-1 rounded-full border px-3 py-2 text-sm",
                props.value === d ? "font-semibold" : "opacity-70",
            ].join(" ")}
        >
            {label}
        </button>
    );

    return (
        <div className="mt-3 flex gap-2">
            {btn("SOFTWARE", "Software")}
            {btn("STORY", "Story")}
        </div>
    );
}

function SchoolChips(props: {
    schools: Array<{ code: string; name: string; count: number }>;
    value: string | null;
    onChange: (code: string) => void;
}) {
    return (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {props.schools.map((s) => {
                const active = props.value === s.code;
                return (
                    <button
                        key={s.code}
                        onClick={() => props.onChange(s.code)}
                        className={[
                            "shrink-0 rounded-full border px-3 py-1.5 text-sm",
                            active ? "font-semibold" : "opacity-70",
                        ].join(" ")}
                    >
                        {s.code} <span className="opacity-60">({s.count})</span>
                    </button>
                );
            })}
        </div>
    );
}

export default function LibraryPage() {
    const [domain, setDomain] = useState<Domain>("SOFTWARE");
    type LibraryMode = "ACTIONS" | "PROMPTS";
    const [mode, setMode] = useState<LibraryMode>("ACTIONS");

    const [open, setOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ["library"],
        queryFn: fetchLibrary,
    });

    const [schoolCode, setSchoolCode] = useState<string | null>(null);

    const actionsInDomain = useMemo(() => {
        const all = data?.cards ?? [];
        return all.filter(
            (c) =>
                c.kind === "ACTION" &&
                c.zone === "LIBRARY" &&
                c.domain === domain &&
                c.schoolCode !== null // ignore null-school actions
        );
    }, [data?.cards, domain]);

    const schools = useMemo(() => {
        const map = new Map<string, { code: string; name: string; count: number }>();
        for (const c of actionsInDomain) {
            const code = c.schoolCode!;
            const name = c.schoolName ?? code;
            const prev = map.get(code);
            if (!prev) map.set(code, { code, name, count: 1 });
            else prev.count += 1;
        }
        return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
    }, [actionsInDomain]);

    useEffect(() => {
        if (!schools.length) return;
        if (schoolCode && schools.some((s) => s.code === schoolCode)) return;
        setSchoolCode(schools[0].code);
    }, [schools, schoolCode]);

    const visibleCards = useMemo(() => {
        if (!schoolCode) return [];
        return actionsInDomain
            .filter((c) => c.schoolCode === schoolCode)
            .sort((a, b) => (a.canonId ?? "").localeCompare(b.canonId ?? ""));
    }, [actionsInDomain, schoolCode]);

    const prompts = useMemo(() => {
        const all = data?.cards ?? [];
        return all
            .filter((c) => c.kind === "PROMPT" && c.zone === "LIBRARY")
            .sort((a, b) => (a.canonId ?? a.anchor).localeCompare(b.canonId ?? b.anchor));
    }, [data?.cards]);

    const [promptQ, setPromptQ] = useState("");

    const promptsFiltered = useMemo(() => {
        const t = promptQ.trim().toLowerCase();
        if (!t) return prompts;
        return prompts.filter(
            (c) =>
                c.anchor.toLowerCase().includes(t) ||
                c.body.toLowerCase().includes(t) ||
                (c.canonId ?? "").toLowerCase().includes(t)
        );
    }, [prompts, promptQ]);

    const [q, setQ] = useState("");

    const visibleCardsFiltered = useMemo(() => {
        const base = visibleCards;
        const t = q.trim().toLowerCase();
        if (!t) return base;
        return base.filter(
            (c) =>
                c.anchor.toLowerCase().includes(t) ||
                c.body.toLowerCase().includes(t) ||
                (c.canonId ?? "").toLowerCase().includes(t)
        );
    }, [visibleCards, q]);

    const selectedCard = useMemo(() => {
        if (!selectedId) return null;
        const c = (data?.cards ?? []).find((x) => x.id === selectedId);
        // Library cards are never drafts
        return c ? { id: c.id, anchor: c.anchor, body: c.body, isDraft: false } : null;
    }, [selectedId, data?.cards]);

    return (
        <MobileContainer>
            <div className="text-lg font-semibold">Library</div>

            {isLoading && <div className="mt-3 text-sm opacity-70">Loading…</div>}
            {error && <div className="mt-3 text-sm text-red-600">Failed to load.</div>}

            <ModeToggle value={mode} onChange={setMode} />

            {mode === "ACTIONS" ? (
                <>
                    <DomainToggle value={domain} onChange={setDomain} />
                    <SchoolChips schools={schools} value={schoolCode} onChange={setSchoolCode} />

                    <div className="mt-3">
                        <div className="text-sm opacity-70">
                            {schools.find((s) => s.code === schoolCode)?.name ?? ""}
                            {schoolCode ? ` (${schoolCode})` : ""}
                        </div>

                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search within school"
                            className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                        />
                    </div>

                    <div className="mt-3 space-y-3">
                        {visibleCardsFiltered.map((c) => (
                            <CardTile
                                key={c.id}
                                id={c.id}
                                anchor={c.anchor}
                                bodyPreview={preview(c.body)}
                                isDraft={false}
                                onOpenDetails={(cardId) => {
                                    setSelectedId(cardId);
                                    setOpen(true);
                                }}
                            />
                        ))}
                    </div>
                </>
            ) : (
                <>
                    <div className="mt-3">
                        <div className="text-sm opacity-70">Execution prompts</div>
                        <input
                            value={promptQ}
                            onChange={(e) => setPromptQ(e.target.value)}
                            placeholder="Search prompts"
                            className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                        />
                    </div>

                    <div className="mt-3 space-y-3">
                        {promptsFiltered.map((c) => (
                            <CardTile
                                key={c.id}
                                id={c.id}
                                anchor={c.anchor}
                                bodyPreview={preview(c.body)}
                                isDraft={false}
                                onOpenDetails={(cardId) => {
                                    setSelectedId(cardId);
                                    setOpen(true);
                                }}
                            />
                        ))}
                    </div>
                </>
            )}

            <CardDetailsSheet open={open} onOpenChange={setOpen} card={selectedCard} />
        </MobileContainer>
    );
}

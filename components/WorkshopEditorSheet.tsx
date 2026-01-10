"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export type EditorDraft = {
    kind: "OUTPUT" | "PROMPT";
    anchor: string;
    body: string;
    domain: "SOFTWARE" | "STORY" | "NONE";
    meta: any;
};

type WorkshopCard = {
    id: string;
    kind: "PROMPT" | "OUTPUT";
    domain: "SOFTWARE" | "STORY" | "NONE";
    anchor: string;
    body: string;
    meta: any;
};

function defaultDraft(kind: "OUTPUT" | "PROMPT"): EditorDraft {
    if (kind === "PROMPT") {
        return {
            kind,
            anchor: "New Prompt",
            body: "Describe what to build next, grounded in the evolving story and targets.",
            domain: "NONE",
            meta: { prompt_type: "EXECUTION" },
        };
    }
    return {
        kind,
        anchor: "New Output",
        body: "A small chunk of story/software output.",
        domain: "NONE",
        meta: { chunk_type: "text", tag: "story" },
    };
}

export default function WorkshopEditorSheet(props: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    kind: "OUTPUT" | "PROMPT";
    editing: WorkshopCard | null;
    onSaved: () => Promise<void> | void;
}) {
    const isEdit = Boolean(props.editing);

    const initial = useMemo(() => {
        if (props.editing) {
            return {
                kind: props.editing.kind,
                anchor: props.editing.anchor,
                body: props.editing.body,
                domain: props.editing.domain,
                meta: props.editing.meta ?? {},
            } satisfies EditorDraft;
        }
        return defaultDraft(props.kind);
    }, [props.editing, props.kind]);

    const [draft, setDraft] = useState<EditorDraft>(initial);

    // useEffect(() => {
    //     setDraft(initial);
    // }, [initial, props.open]);

    useEffect(() => {
        if (!props.open) return;

        if (props.editing) {
            setDraft({
                kind: props.editing.kind,
                anchor: props.editing.anchor,
                body: props.editing.body,
                domain: props.editing.domain,
                meta: props.editing.meta ?? {},
            });
        } else {
            setDraft(defaultDraft(props.kind));
        }
    }, [props.open, props.editing?.id, props.kind]);


    const saveMutation = useMutation({
        mutationFn: async () => {
            if (isEdit && props.editing) {
                const res = await fetch(`/api/workshop/cards/${props.editing.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        anchor: draft.anchor,
                        body: draft.body,
                        domain: draft.domain,
                        meta: draft.kind === "PROMPT" ? { prompt_type: "EXECUTION", ...draft.meta } : draft.meta,
                    }),
                });
                if (!res.ok) throw new Error("Update failed");
                return;
            }

            const res = await fetch(`/api/workshop/cards`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    kind: draft.kind,
                    anchor: draft.anchor,
                    body: draft.body,
                    domain: draft.domain,
                    meta: draft.kind === "PROMPT" ? { prompt_type: "EXECUTION", ...draft.meta } : draft.meta,
                }),
            });
            if (!res.ok) throw new Error("Create failed");
        },
        onSuccess: async() => {
           await props.onSaved();
            props.onOpenChange(false);
        },
    });

    const isOutput = draft.kind === "OUTPUT";

    return (
        <Sheet open={props.open} onOpenChange={props.onOpenChange}>
            <SheetContent side="bottom" className="max-w-md mx-auto flex max-h-[85dvh] flex-col">
                <SheetHeader>
                    <SheetTitle>{isEdit ? "Edit Card" : "Create Card"}</SheetTitle>
                </SheetHeader>

                <div className="mt-4 flex-1 overflow-y-auto space-y-3 pb-2">
                    <label className="block">
                        <div className="text-xs opacity-70">Anchor</div>
                        <input
                            value={draft.anchor}
                            onChange={(e) => setDraft((d) => ({ ...d, anchor: e.target.value }))}
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            maxLength={80}
                        />
                    </label>

                    <label className="block">
                        <div className="text-xs opacity-70">Domain</div>
                        <select
                            value={draft.domain}
                            onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value as any }))}
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                        >
                            <option value="NONE">None</option>
                            <option value="STORY">Story</option>
                            <option value="SOFTWARE">Software</option>
                        </select>
                    </label>

                    {isOutput ? (
                        <>
                            <label className="block">
                                <div className="text-xs opacity-70">Chunk Type</div>
                                <select
                                    value={draft.meta?.chunk_type ?? "text"}
                                    onChange={(e) =>
                                        setDraft((d) => ({
                                            ...d,
                                            meta: { ...(d.meta ?? {}), chunk_type: e.target.value },
                                        }))
                                    }
                                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                                >
                                    <option value="text">text</option>
                                    <option value="code">code</option>
                                </select>
                            </label>

                            <label className="block">
                                <div className="text-xs opacity-70">Tag</div>
                                <select
                                    value={draft.meta?.tag ?? "story"}
                                    onChange={(e) =>
                                        setDraft((d) => ({
                                            ...d,
                                            meta: { ...(d.meta ?? {}), tag: e.target.value },
                                        }))
                                    }
                                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                                >
                                    <option value="story">story</option>
                                    <option value="software">software</option>
                                    <option value="none">none</option>
                                </select>
                            </label>

                            {draft.meta?.chunk_type === "code" ? (
                                <label className="block">
                                    <div className="text-xs opacity-70">Language (optional)</div>
                                    <input
                                        value={draft.meta?.language ?? ""}
                                        onChange={(e) =>
                                            setDraft((d) => ({
                                                ...d,
                                                meta: { ...(d.meta ?? {}), language: e.target.value },
                                            }))
                                        }
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                                        placeholder="ts, tsx, sql…"
                                    />
                                </label>
                            ) : null}
                        </>
                    ) : (
                        <div className="text-xs opacity-70">
                            Prompt type is fixed to <b>EXECUTION</b> in v1.
                        </div>
                    )}

                    <label className="block">
                        <div className="text-xs opacity-70">Body</div>
                        <textarea
                            value={draft.body}
                            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm min-h-[160px]"
                        />
                    </label>
                </div>

                <div className="mt-2 flex gap-2">
                    <Button variant="secondary" className="flex-1" onClick={() => props.onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button className="flex-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                        Save
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}

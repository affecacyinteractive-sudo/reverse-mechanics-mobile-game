"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

type Kind = "OUTPUT" | "PROMPT";

type EditingCard = {
    id: string;
    kind: Kind;
    domain: "SOFTWARE" | "STORY" | "NONE";
    anchor: string;
    body: string;
    meta: any;
    isDraft: boolean;
};

function isPlainObject(v: unknown): v is Record<string, any> {
    return !!v && typeof v === "object" && !Array.isArray(v);
}

function defaultDraft(kind: Kind) {
    if (kind === "PROMPT") {
        return {
            domain: "NONE" as const,
            anchor: "Execution Prompt",
            body: "",
            meta: { prompt_type: "EXECUTION" },
        };
    }
    return {
        domain: "NONE" as const,
        anchor: "Output Card",
        body: "",
        meta: { chunk_type: "text" },
    };
}

export default function WorkshopEditorSheet(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: Kind;
    editing: EditingCard | null;
    onSaved: () => Promise<void> | void;
}) {
    const [draft, setDraft] = useState(() => defaultDraft(props.kind));
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const title = useMemo(() => {
        if (props.kind === "PROMPT") return props.editing ? "Edit Prompt Draft" : "New Prompt (Gatekeeper)";
        return props.editing ? "Edit Output Draft" : "New Output";
    }, [props.kind, props.editing]);

    // stable reset on open / id change
    useEffect(() => {
        if (!props.open) return;

        setMsg(null);

        if (props.editing) {
            setDraft({
                domain: props.editing.domain,
                anchor: props.editing.anchor,
                body: props.editing.body,
                meta: props.editing.meta ?? {},
            });
        } else {
            setDraft(defaultDraft(props.kind));
        }
    }, [props.open, props.editing?.id, props.kind]);

    async function save() {
        setMsg(null);

        const anchor = draft.anchor?.trim?.() ?? "";
        const body = draft.body ?? "";

        if (!anchor) return setMsg("Anchor is required.");
        if (!body.trim()) return setMsg("Body is required.");

        setSaving(true);
        try {
            if (props.kind === "OUTPUT") {
                if (props.editing) {
                    const res = await fetch(`/api/workshop/cards/${props.editing.id}`, {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                            anchor,
                            body,
                            domain: draft.domain,
                            meta: isPlainObject(draft.meta) ? draft.meta : {},
                        }),
                    });
                    if (!res.ok) throw new Error("Failed to update output draft");
                } else {
                    const res = await fetch("/api/workshop/cards", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                            kind: "OUTPUT",
                            anchor,
                            body,
                            domain: draft.domain,
                            meta: isPlainObject(draft.meta) ? draft.meta : {},
                        }),
                    });
                    if (!res.ok) throw new Error("Failed to create output draft");
                }

                await props.onSaved();
                props.onOpenChange(false);
                return;
            }

            // PROMPT gatekeeper path
            if (!props.editing) {
                // Create candidate: accept => insert draft, reject => create nothing
                const res = await fetch("/api/workshop/prompts/gatekeeper", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        mode: "create",
                        anchor,
                        body,
                        domain: draft.domain,
                        meta: isPlainObject(draft.meta) ? draft.meta : {},
                    }),
                });

                if (!res.ok) throw new Error("Gatekeeper failed");
                const data = await res.json();

                if (!data.accepted) {
                    setMsg(`${data.reason ?? "Rejected."} (score ${data.score ?? "?"})`);
                    return;
                }

                setMsg(`Accepted (score ${data.score}). Draft prompt created.`);
                await props.onSaved();
                props.onOpenChange(false);
                return;
            }

            // Revalidate an existing draft prompt; reject => delete candidate
            const res = await fetch("/api/workshop/prompts/gatekeeper", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    mode: "revalidate",
                    id: props.editing.id,
                    anchor,
                    body,
                    domain: draft.domain,
                    meta: isPlainObject(draft.meta) ? draft.meta : {},
                }),
            });

            if (!res.ok) throw new Error("Gatekeeper failed");
            const data = await res.json();

            if (!data.accepted) {
                // draft candidate deleted on server
                setMsg(`${data.reason ?? "Rejected."} Draft was discarded. (score ${data.score ?? "?"})`);
                await props.onSaved();
                props.onOpenChange(false);
                return;
            }

            setMsg(`Accepted (score ${data.score}). Draft updated.`);
            await props.onSaved();
            props.onOpenChange(false);
        } catch (e: any) {
            setMsg(e?.message ?? "Save failed");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Sheet open={props.open} onOpenChange={props.onOpenChange}>
            <SheetContent side="bottom" className="max-w-md mx-auto">
                <SheetHeader>
                    <SheetTitle>{title}</SheetTitle>
                </SheetHeader>

                <div className="mt-4 space-y-3">
                    <div className="space-y-1">
                        <div className="text-xs opacity-70">Anchor</div>
                        <input
                            value={draft.anchor}
                            onChange={(e) => setDraft((d) => ({ ...d, anchor: e.target.value }))}
                            className="w-full rounded-lg border px-3 py-2 text-sm"
                            maxLength={80}
                        />
                    </div>

                    <div className="space-y-1">
                        <div className="text-xs opacity-70">
                            {props.kind === "PROMPT" ? "Prompt Text" : "Body"}
                        </div>
                        <textarea
                            value={draft.body}
                            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                            className="min-h-[180px] w-full rounded-lg border px-3 py-2 text-sm"
                        />
                    </div>

                    <div className="flex gap-2">
                        <Button onClick={save} disabled={saving}>
                            {props.kind === "PROMPT" ? "Submit to Gatekeeper" : "Save Draft"}
                        </Button>
                        <Button variant="secondary" onClick={() => props.onOpenChange(false)} disabled={saving}>
                            Cancel
                        </Button>
                    </div>

                    {msg ? <div className="text-sm opacity-80">{msg}</div> : null}

                    {props.kind === "PROMPT" ? (
                        <div className="text-xs opacity-60">
                            Gatekeeper is simulated. Rephrase to change the score.
                        </div>
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}

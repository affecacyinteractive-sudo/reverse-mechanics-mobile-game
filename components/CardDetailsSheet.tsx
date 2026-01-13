"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useHandStore } from "@/store/handStore";

export default function CardDetailsSheet(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;

    showCommit?: boolean;
    onCommitToggle?: (nextCommitted: boolean, cardId: string) => Promise<void> | void;

    card: {
        id: string;
        anchor: string;
        body: string;
        isDraft?: boolean;
        isCommitted?: boolean;
    } | null;
}) {
    const toggle = useHandStore((s) => s.toggle);

    const inHand = useHandStore((s) =>
        props.card ? s.items.some((x) => x.kind === "card" && x.id === props.card!.id) : false
    );

    const isDraft = Boolean(props.card?.isDraft);

    return (
        <Sheet open={props.open} onOpenChange={props.onOpenChange}>
            {/* Make the sheet a flex column and prevent the whole sheet from scrolling */}
            <SheetContent side="bottom" className="max-w-md mx-auto p-0">
                <div className="flex h-[85vh] flex-col">
                    {/* Sticky top bar */}
                    <div className="sticky top-0 z-10 border-b bg-background px-4 py-3">
                        <SheetHeader>
                            <SheetTitle className="truncate">{props.card?.anchor ?? "Card"}</SheetTitle>
                        </SheetHeader>

                        {props.card ? (
                            <div className="mt-3 flex items-center gap-2">
                                <Button
                                    variant={inHand ? "secondary" : "default"}
                                    size="sm"
                                    disabled={isDraft}
                                    onClick={() => {
                                        if (isDraft) return;
                                        toggle({ kind: "card", id: props.card!.id });
                                    }}
                                    title={isDraft ? "Draft cards can’t be added to Hand." : undefined}
                                >
                                    {isDraft ? "Draft" : inHand ? "In Hand" : "+ Hand"}
                                </Button>

                                {props.showCommit ? (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={isDraft}
                                        onClick={async () => {
                                            const next = !Boolean(props.card?.isCommitted);
                                            await props.onCommitToggle?.(next, props.card!.id);
                                        }}
                                        title={isDraft ? "Draft cards can’t be committed." : undefined}
                                    >
                                        {props.card?.isCommitted ? "Uncommit" : "Commit"}
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    {/* Scrollable content area */}
                    <div className="flex-1 overflow-auto px-4 py-4">
                        {props.card ? (
                            <div className="space-y-4">
                                <div className="rounded-lg border p-3">
                                    <pre className="whitespace-pre-wrap text-sm leading-relaxed">{props.card.body}</pre>
                                </div>

                                <div className="text-xs opacity-60">ID: {props.card.id}</div>
                            </div>
                        ) : (
                            <div className="text-sm opacity-70">No card selected.</div>
                        )}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}

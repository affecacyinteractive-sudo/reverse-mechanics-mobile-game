"use client";

import { usePathname } from "next/navigation";
import { useBoardStore } from "@/store/boardStore";
import { useHandStore } from "@/store/handStore";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

import { useQuery } from "@tanstack/react-query";
import { fetchCardMeta, isAction, isExecutionPrompt, isOutput } from "@/lib/cardMeta";


export default function HandSheet() {
    const isOpen = useHandStore((s) => s.isOpen);
    const close = useHandStore((s) => s.close);
    const items = useHandStore((s) => s.items);
    const clear = useHandStore((s) => s.clear);
    const remove = useHandStore((s) => s.remove);

    const pathname = usePathname();
    const onBoard = pathname === "/board";

    const addTarget = useBoardStore((s) => s.addTarget);
    const setAction = useBoardStore((s) => s.setAction);
    const setPrompt = useBoardStore((s) => s.setPrompt);

    const boardTargets = useBoardStore((s) => s.targetCardIds);
    const boardAction = useBoardStore((s) => s.actionCardId);
    const boardPrompt = useBoardStore((s) => s.promptCardId);


    const cardIds = items.filter((x) => x.kind === "card").map((x) => x.id);

    const { data: metaMap } = useQuery({
        queryKey: ["card-meta", cardIds.slice().sort().join(",")],
        queryFn: () => fetchCardMeta(cardIds),
        enabled: onBoard && isOpen && cardIds.length > 0,
    });

    const closeAfterPlace = (kind: "targets" | "action" | "prompt") => {
        // Keep targets open (you may add many); close for action/prompt.
        if (kind === "action" || kind === "prompt") close();
    };




    return (
        <Sheet open={isOpen} onOpenChange={(v) => (v ? null : close())}>
            <SheetContent side="bottom" className="max-w-md mx-auto flex max-h-[85dvh] flex-col">
                <SheetHeader>
                    <SheetTitle>Hand</SheetTitle>
                </SheetHeader>

                <div className="mt-4 flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={clear} disabled={items.length === 0}>
                        Clear
                    </Button>
                </div>

                <div className="mt-4 flex-1 overflow-y-auto space-y-2 pb-2">
                    {items.length === 0 ? (
                        <div className="text-sm opacity-70">Your hand is empty.</div>
                    ) : (
                        items.map((it) => (
                            <div
                                key={`${it.kind}:${it.id}`}
                                className="space-y-2 rounded-md border p-3"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="text-sm">
                                        <div className="font-medium">{it.kind.toUpperCase()}</div>
                                        <div className="opacity-70">{it.id}</div>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => remove(it)}>
                                        Remove
                                    </Button>
                                </div>

                                {onBoard && it.kind === "card" ? (() => {

                                    const m = metaMap?.[it.id];

                                    const canToTargets = isOutput(m);          // OUTPUT only
                                    const canToAction  = isAction(m);          // ACTION only
                                    const canToPrompt  = isExecutionPrompt(m); // PROMPT+EXECUTION only

                                    const alreadyTarget = boardTargets.includes(it.id);
                                    const alreadyAction = boardAction === it.id;
                                    const alreadyPrompt = boardPrompt === it.id;

                                    return (
                                        <div className="flex gap-2 flex-wrap">
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                    if (!canToTargets || alreadyTarget) return;
                                                    addTarget(it.id);
                                                    closeAfterPlace("targets");
                                                }}
                                                disabled={!canToTargets || alreadyTarget}
                                                title={
                                                    !canToTargets
                                                        ? "Targets must be OUTPUT cards"
                                                        : alreadyTarget
                                                            ? "Already in Targets"
                                                            : undefined
                                                }
                                            >
                                                {alreadyTarget ? "Target ✓" : "To Targets"}
                                            </Button>


                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                    if (!canToAction || alreadyAction) return;
                                                    setAction(it.id);
                                                    closeAfterPlace("action");
                                                }}
                                                disabled={!canToAction || alreadyAction}
                                                title={
                                                    !canToAction
                                                        ? "Action slot requires an ACTION card"
                                                        : alreadyAction
                                                            ? "Already set as Action"
                                                            : undefined
                                                }
                                            >
                                                {alreadyAction ? "Action ✓" : "To Action"}
                                            </Button>


                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                    if (!canToPrompt || alreadyPrompt) return;
                                                    setPrompt(it.id);
                                                    closeAfterPlace("prompt");
                                                }}
                                                disabled={!canToPrompt || alreadyPrompt}
                                                title={
                                                    !canToPrompt
                                                        ? "Prompt slot requires an EXECUTION PROMPT card"
                                                        : alreadyPrompt
                                                            ? "Already set as Prompt"
                                                            : undefined
                                                }
                                            >
                                                {alreadyPrompt ? "Prompt ✓" : "To Prompt"}
                                            </Button>


                                        </div>
                                    );
                                })() : null}

                            </div>
                        ))

                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}

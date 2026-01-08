"use client";

import { useMemo } from "react";
import { useHandStore } from "@/store/handStore";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

export default function CardDetailsSheet(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;

    card: {
        id: string;
        anchor: string;
        body: string;
    } | null;
}) {
    const toggle = useHandStore((s) => s.toggle);

    const inHand = useHandStore((s) =>
        props.card ? s.items.some((x) => x.kind === "card" && x.id === props.card!.id) : false
    );

    return (
        <Sheet open={props.open} onOpenChange={props.onOpenChange}>
            <SheetContent side="bottom" className="max-w-md mx-auto">
                <SheetHeader>
                    <SheetTitle>{props.card?.anchor ?? "Card"}</SheetTitle>
                </SheetHeader>

                {props.card ? (
                    <div className="mt-4 space-y-4">
                        <div className="flex items-center gap-2">
                            <Button
                                variant={inHand ? "secondary" : "default"}
                                size="sm"
                                onClick={() => toggle({ kind: "card", id: props.card!.id })}
                            >
                                {inHand ? "In Hand" : "+ Hand"}
                            </Button>
                        </div>

                        <div className="rounded-lg border p-3">
                            <div className="whitespace-pre-wrap text-sm leading-relaxed">
                                {props.card.body}
                            </div>
                        </div>

                        <div className="text-xs opacity-60">ID: {props.card.id}</div>
                    </div>
                ) : (
                    <div className="mt-4 text-sm opacity-70">No card selected.</div>
                )}
            </SheetContent>
        </Sheet>
    );
}

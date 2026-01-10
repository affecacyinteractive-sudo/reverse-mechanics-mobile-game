"use client";

import { useHandStore } from "@/store/handStore";

export function CardTile(props: {
    id: string;
    anchor: string;
    bodyPreview: string;

    // NEW: if true, cannot be added to hand
    isDraft?: boolean;

    onOpenDetails: (cardId: string) => void;
}) {
    const toggle = useHandStore((s) => s.toggle);
    const inHand = useHandStore((s) => s.items.some((x) => x.kind === "card" && x.id === props.id));

    const disabled = Boolean(props.isDraft);

    return (
        <div
            className="rounded-xl border p-4 active:scale-[0.99] transition"
            onClick={() => props.onOpenDetails(props.id)}
            role="button"
            tabIndex={0}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-semibold">{props.anchor}</div>
                    <div className="mt-1 text-sm opacity-80 line-clamp-3">{props.bodyPreview}</div>
                </div>

                <button
                    disabled={disabled}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (disabled) return;
                        toggle({ kind: "card", id: props.id });
                    }}
                    title={disabled ? "Draft cards can’t be added to Hand. Remove Draft first." : undefined}
                    className={[
                        "shrink-0 rounded-full border px-3 py-1 text-sm",
                        disabled ? "opacity-40" : inHand ? "font-semibold" : "opacity-80",
                    ].join(" ")}
                >
                    {disabled ? "Draft" : inHand ? "In Hand" : "+ Hand"}
                </button>
            </div>
        </div>
    );
}

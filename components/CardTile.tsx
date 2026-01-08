"use client";

import { useHandStore } from "@/store/handStore";

export function CardTile(props: {
    id: string;
    anchor: string;
    bodyPreview: string;

    onOpenDetails: (cardId: string) => void;
}) {
    const toggle = useHandStore((s) => s.toggle);
    const inHand = useHandStore((s) =>
        s.items.some((x) => x.kind === "card" && x.id === props.id)
    );


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
                    <div className="mt-1 text-sm opacity-80 line-clamp-3">
                        {props.bodyPreview}
                    </div>
                </div>

                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        toggle({ kind: "card", id: props.id });
                    }}
                    className={[
                        "shrink-0 rounded-full border px-3 py-1 text-sm",
                        inHand ? "font-semibold" : "opacity-80",
                    ].join(" ")}
                >
                    {inHand ? "In Hand" : "+ Hand"}
                </button>
            </div>
        </div>
    );
}

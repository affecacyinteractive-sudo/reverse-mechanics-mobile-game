"use client";

import { useMemo } from "react";
import { useHandStore } from "@/store/handStore";

export default function HandTray() {
    const items = useHandStore((s) => s.items);
    const toggleOpen = useHandStore((s) => s.toggleOpen);

    const preview = useMemo(() => {
        // show last 3 items, newest at the end
        const last = items.slice(-3);
        return last.map((it) => `${it.kind === "card" ? "C" : "D"}:${it.id}`);
    }, [items]);

    return (
        <button
            onClick={toggleOpen}
            className="w-full border-t bg-background px-4 py-2 text-left"
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                    <span className="font-medium">Hand</span>
                    <span className="text-sm opacity-70">({items.length})</span>
                </div>

                {preview.length > 0 ? (
                    <div className="flex gap-1 overflow-hidden">
                        {preview.map((t) => (
                            <span
                                key={t}
                                className="max-w-[120px] truncate rounded-full border px-2 py-0.5 text-xs opacity-80"
                            >
                {t}
              </span>
                        ))}
                    </div>
                ) : (
                    <span className="text-xs opacity-60">Tap to open</span>
                )}
            </div>
        </button>
    );
}

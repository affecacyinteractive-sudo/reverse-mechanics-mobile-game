// components/DeckRow.tsx
import type { ReactNode } from "react";

export default function DeckRow({ children }: { children: ReactNode }) {
    return (
        <div className="-mx-4 px-4">
            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2">
                {children}
            </div>
        </div>
    );
}

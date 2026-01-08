"use client";

import { useHandStore } from "@/store/handStore";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

export default function HandSheet() {
    const isOpen = useHandStore((s) => s.isOpen);
    const close = useHandStore((s) => s.close);
    const items = useHandStore((s) => s.items);
    const clear = useHandStore((s) => s.clear);
    const remove = useHandStore((s) => s.remove);

    return (
        <Sheet open={isOpen} onOpenChange={(v) => (v ? null : close())}>
            <SheetContent side="bottom" className="max-w-md mx-auto">
                <SheetHeader>
                    <SheetTitle>Hand</SheetTitle>
                </SheetHeader>

                <div className="mt-4 flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={clear} disabled={items.length === 0}>
                        Clear
                    </Button>
                </div>

                <div className="mt-4 space-y-2">
                    {items.length === 0 ? (
                        <div className="text-sm opacity-70">Your hand is empty.</div>
                    ) : (
                        items.map((it) => (
                            <div
                                key={`${it.kind}:${it.id}`}
                                className="flex items-center justify-between rounded-md border p-3"
                            >
                                <div className="text-sm">
                                    <div className="font-medium">{it.kind.toUpperCase()}</div>
                                    <div className="opacity-70">{it.id}</div>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => remove(it)}>
                                    Remove
                                </Button>
                            </div>
                        ))
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}

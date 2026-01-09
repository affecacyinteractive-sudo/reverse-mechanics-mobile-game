// components/BoardSlot.tsx
import type { ReactNode } from "react";

export default function BoardSlot(props: {
    title: string;
    hint: string;
    status?: string;
    children?: ReactNode;
}) {
    const empty = !props.children;

    return (
        <section className="rounded-2xl border p-4">
            <div className="flex items-baseline justify-between gap-3">
                <div className="font-semibold">{props.title}</div>
                {props.status ? (
                    <div className="text-xs opacity-60">{props.status}</div>
                ) : null}
            </div>

            <div className="mt-2">
                {empty ? (
                    <div className="text-sm opacity-70">{props.hint}</div>
                ) : (
                    props.children
                )}
            </div>
        </section>
    );
}

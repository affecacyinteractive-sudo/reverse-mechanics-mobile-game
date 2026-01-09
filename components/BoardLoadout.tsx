"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import BoardSlot from "@/components/BoardSlot";
import { useBoardStore } from "@/store/boardStore";
import { fetchCardMeta } from "@/lib/cardMeta";

function Pill(props: { label: string; onRemove?: () => void }) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2">
            <div className="text-sm font-medium">{props.label}</div>
            {props.onRemove ? (
                <button className="text-xs opacity-70" onClick={props.onRemove}>
                    Remove
                </button>
            ) : null}
        </div>
    );
}

export default function BoardLoadout() {
    const targetCardIds = useBoardStore((s) => s.targetCardIds);
    const actionCardId = useBoardStore((s) => s.actionCardId);
    const promptCardId = useBoardStore((s) => s.promptCardId);

    const removeTarget = useBoardStore((s) => s.removeTarget);
    const setAction = useBoardStore((s) => s.setAction);
    const setPrompt = useBoardStore((s) => s.setPrompt);

    const idsToLabel = useMemo(() => {
        const ids = [
            ...targetCardIds,
            actionCardId ?? "",
            promptCardId ?? "",
        ].filter(Boolean) as string[];
        return Array.from(new Set(ids));
    }, [targetCardIds, actionCardId, promptCardId]);

    const { data: metaMap = {} } = useQuery({
        queryKey: ["card-meta", idsToLabel.slice().sort().join(",")],
        queryFn: () => fetchCardMeta(idsToLabel),
        enabled: idsToLabel.length > 0,
    });

    const labelFor = (id: string) => metaMap[id]?.anchor ?? id;

    const targetsStatus =
        targetCardIds.length > 0 ? `${targetCardIds.length} selected` : "Optional";
    const actionStatus = actionCardId ? "Selected" : "Required";
    const promptStatus = promptCardId ? "Selected" : "Required";

    return (
        <div className="space-y-3">
            <BoardSlot title="Targets" hint="Add one or more OUTPUT cards (optional)." status={targetsStatus}>
                {targetCardIds.length ? (
                    <div className="space-y-2">
                        {targetCardIds.map((id) => (
                            <Pill key={id} label={labelFor(id)} onRemove={() => removeTarget(id)} />
                        ))}
                    </div>
                ) : null}
            </BoardSlot>

            <BoardSlot title="Action" hint="Add exactly one ACTION card." status={actionStatus}>
                {actionCardId ? (
                    <Pill label={labelFor(actionCardId)} onRemove={() => setAction(null)} />
                ) : null}
            </BoardSlot>

            <BoardSlot title="Prompt" hint="Add exactly one EXECUTION PROMPT." status={promptStatus}>
                {promptCardId ? (
                    <Pill label={labelFor(promptCardId)} onRemove={() => setPrompt(null)} />
                ) : null}
            </BoardSlot>
        </div>
    );
}

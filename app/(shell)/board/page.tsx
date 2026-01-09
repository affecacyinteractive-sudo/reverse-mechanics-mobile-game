"use client";

import MobileContainer from "@/components/MobileContainer";
import BoardLoadout from "@/components/BoardLoadout";
import { useBoardStore } from "@/store/boardStore";

import { useQuery } from "@tanstack/react-query";
import { fetchCardMeta, isAction, isExecutionPrompt } from "@/lib/cardMeta";


export default function BoardPage() {
    const actionCardId = useBoardStore((s) => s.actionCardId);
    const promptCardId = useBoardStore((s) => s.promptCardId);
    const clearBoard = useBoardStore((s) => s.clearBoard);

    const idsToCheck = [actionCardId, promptCardId].filter(Boolean) as string[];

    const { data: metaMap } = useQuery({
        queryKey: ["board-meta", idsToCheck.slice().sort().join(",")],
        queryFn: () => fetchCardMeta(idsToCheck),
        enabled: idsToCheck.length > 0,
    });

    const actionOk = actionCardId ? isAction(metaMap?.[actionCardId]) : false;
    const promptOk = promptCardId ? isExecutionPrompt(metaMap?.[promptCardId]) : false;

    const canRun = actionOk && promptOk;


    return (
        <MobileContainer>
            <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Board</div>

                <div className="flex items-center gap-2">
                    <button
                        className="rounded-full border px-3 py-2 text-sm opacity-80"
                        onClick={clearBoard}
                    >
                        Clear
                    </button>

                    <button
                        className={[
                            "rounded-full px-4 py-2 text-sm font-semibold",
                            canRun ? "bg-black text-white" : "border opacity-50",
                        ].join(" ")}
                        disabled={!canRun}
                    >
                        Run
                    </button>

                </div>
            </div>

            <div className="mt-3">
                <BoardLoadout />
            </div>

            <div className="mt-4 text-xs opacity-60">
                Open Hand and place items deliberately into slots.
            </div>
        </MobileContainer>
    );
}

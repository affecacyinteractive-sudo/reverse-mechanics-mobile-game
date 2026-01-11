"use client";

import MobileContainer from "@/components/MobileContainer";
import BoardLoadout from "@/components/BoardLoadout";
import { useBoardStore } from "@/store/boardStore";

import { useQuery } from "@tanstack/react-query";
import { fetchCardMeta, isAction, isExecutionPrompt } from "@/lib/cardMeta";
import { useRouter } from 'next/navigation';

async function runOnce(payload: { actionId: string; promptId: string; targetIds: string[] }) {
    const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
    console.log(res)
    if (!res.ok) throw new Error("Run failed");
    console.log("Bing Bong")
    return res.json();
}


export default function BoardPage() {
    const router = useRouter();

    const actionCardId = useBoardStore((s) => s.actionCardId);
    const targetCardIds = useBoardStore((s) => s.targetCardIds);
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

                    {/*<button*/}
                    {/*    className={[*/}
                    {/*        "rounded-full px-4 py-2 text-sm font-semibold",*/}
                    {/*        canRun ? "bg-black text-white" : "border opacity-50",*/}
                    {/*    ].join(" ")}*/}
                    {/*    disabled={!canRun}*/}
                    {/*>*/}
                    {/*    Run*/}
                    {/*</button>*/}

                    <button
                        className="w-full rounded-xl border py-3 font-semibold"
                        disabled={!actionCardId || !promptCardId}
                        onClick={async () => {
                            try {
                                const out = await runOnce({ actionId: actionCardId, promptId: promptCardId, targetIds:targetCardIds });
                                // simplest: go to Generated page
                                router.push("/generated");
                            } catch (e) {
                                alert((e as any)?.message ?? "Run failed");
                            }
                        }}
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

// store/boardStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BoardState = {
    targetCardIds: string[];
    actionCardId: string | null;
    promptCardId: string | null;

    addTarget: (cardId: string) => void;
    removeTarget: (cardId: string) => void;
    clearTargets: () => void;

    setAction: (cardId: string | null) => void;
    setPrompt: (cardId: string | null) => void;

    clearBoard: () => void;
};

export const useBoardStore = create<BoardState>()(
    persist(
        (set) => ({
            targetCardIds: [],
            actionCardId: null,
            promptCardId: null,

            addTarget: (cardId) =>
                set((s) =>
                    s.targetCardIds.includes(cardId)
                        ? s
                        : { targetCardIds: [...s.targetCardIds, cardId] }
                ),
            removeTarget: (cardId) =>
                set((s) => ({ targetCardIds: s.targetCardIds.filter((x) => x !== cardId) })),
            clearTargets: () => set({ targetCardIds: [] }),

            setAction: (cardId) => set({ actionCardId: cardId }),
            setPrompt: (cardId) => set({ promptCardId: cardId }),

            clearBoard: () => set({ targetCardIds: [], actionCardId: null, promptCardId: null }),
        }),
        {
            name: "rm-board-v1",
            version: 1,
            partialize: (s) => ({
                targetCardIds: s.targetCardIds,
                actionCardId: s.actionCardId,
                promptCardId: s.promptCardId,
            }),
        }
    )
);

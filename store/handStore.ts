// // store/handStore.ts
// import { create } from "zustand";
// import { persist } from "zustand/middleware";
//
// export type HandItem =
//     | { kind: "card"; id: string }
//     | { kind: "deck"; id: string };
//
// type HandState = {
//     items: HandItem[];
//     isOpen: boolean;
//
//     open: () => void;
//     close: () => void;
//     toggleOpen: () => void;
//
//     has: (item: HandItem) => boolean;
//     add: (item: HandItem) => void;
//     remove: (item: HandItem) => void;
//     toggle: (item: HandItem) => void;
//     clear: () => void;
// };
//
// function same(a: HandItem, b: HandItem) {
//     return a.kind === b.kind && a.id === b.id;
// }
//
// const keyOf = (it: HandItem) => `${it.kind}:${it.id}`;
//
// const dedupe = (items: HandItem[]) => {
//     const seen = new Set<string>();
//     const out: HandItem[] = [];
//     for (const it of items) {
//         const k = keyOf(it);
//         if (seen.has(k)) continue;
//         seen.add(k);
//         out.push(it);
//     }
//     return out;
// };
//
// // export const useHandStore = create<HandState>((set, get) => ({
// //     items: [],
// //     isOpen: false,
// //
// //     open: () => set({ isOpen: true }),
// //     close: () => set({ isOpen: false }),
// //     toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
// //
// //     has: (item) => get().items.some((x) => same(x, item)),
// //     add: (item) =>
// //         set((s) => (s.items.some((x) => same(x, item)) ? s : { items: [...s.items, item] })),
// //     remove: (item) => set((s) => ({ items: s.items.filter((x) => !same(x, item)) })),
// //     toggle: (item) => (get().has(item) ? get().remove(item) : get().add(item)),
// //     clear: () => set({ items: [] }),
// // }));
//
// export const useHandStore = create<HandState>()(
//     persist(
//         (set,get) => ({
//             items: [],
//             isOpen: false,
//
//             open: () => set({ isOpen: true }),
//             close: () => set({ isOpen: false }),
//             toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
//
//             has: (item) => get().items.some((x) => same(x, item)),
//             add: (id) =>
//                 set((s) => {
//                     if (s.items.some((x) => x.kind === "card" && x.id === id)) return s;
//                     return { items: dedupe([...s.items, { kind: "card", id }]) };
//                 }),
//
//             remove: (id) =>
//                 set((s) => ({
//                     items: s.items.filter((x) => !(x.kind === "card" && x.id === id)),
//                 })),
//
//             toggle: (item) =>
//                 set((s) => {
//                     const exists = s.items.some((x) => x.kind === item.kind && x.id === item.id);
//                     const next = exists
//                         ? s.items.filter((x) => !(x.kind === item.kind && x.id === item.id))
//                         : dedupe([...s.items, item]);
//                     return { items: next };
//                 }),
//
//             clear: () => set({ items: [] }),
//         }),
//         {
//             name: "rm-hand-v1",
//             version: 2,
//             migrate: (persisted: any) => {
//                 const items = Array.isArray(persisted?.items) ? (persisted.items as HandItem[]) : [];
//                 return { ...persisted, items: dedupe(items) };
//             },
//         }
//     )
// );

// store/handStore.ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type HandItem = { kind: "card" | "deck"; id: string };

type HandState = {
    items: HandItem[];
    isOpen: boolean;

    open: () => void;
    close: () => void;
    toggleOpen: () => void;

    has: (item: HandItem) => boolean;
    add: (item: HandItem) => void;
    remove: (item: HandItem) => void;
    toggle: (item: HandItem) => void;

    // convenience helpers (optional, but nice)
    addCard: (id: string) => void;
    removeCard: (id: string) => void;
    addDeck: (id: string) => void;
    removeDeck: (id: string) => void;

    clear: () => void;
};

const keyOf = (it: HandItem) => `${it.kind}:${it.id}`;

const dedupe = (items: HandItem[]) => {
    const seen = new Set<string>();
    const out: HandItem[] = [];
    for (const it of items) {
        const k = keyOf(it);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(it);
    }
    return out;
};

export const useHandStore = create<HandState>()(
    persist(
        (set, get) => ({
            items: [],
            isOpen: false,

            open: () => set({ isOpen: true }),
            close: () => set({ isOpen: false }),
            toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

            has: (item) => get().items.some((x) => x.kind === item.kind && x.id === item.id),

            add: (item) =>
                set((s) => {
                    if (s.items.some((x) => x.kind === item.kind && x.id === item.id)) return s;
                    return { items: dedupe([...s.items, item]) };
                }),

            remove: (item) =>
                set((s) => ({
                    items: s.items.filter((x) => !(x.kind === item.kind && x.id === item.id)),
                })),

            toggle: (item) =>
                set((s) => {
                    const exists = s.items.some((x) => x.kind === item.kind && x.id === item.id);
                    return {
                        items: exists
                            ? s.items.filter((x) => !(x.kind === item.kind && x.id === item.id))
                            : dedupe([...s.items, item]),
                    };
                }),

            addCard: (id) => get().add({ kind: "card", id }),
            removeCard: (id) => get().remove({ kind: "card", id }),
            addDeck: (id) => get().add({ kind: "deck", id }),
            removeDeck: (id) => get().remove({ kind: "deck", id }),

            clear: () => set({ items: [] }),
        }),
        {
            name: "rm-hand-v1",
            version: 3,
            storage: createJSONStorage(() => localStorage),

            // ✅ Always dedupe persisted items on load (even if version didn't change)
            merge: (persisted, current) => {
                const p: any = persisted ?? {};
                const items = Array.isArray(p.items) ? (p.items as HandItem[]) : [];
                return {
                    ...current,
                    ...p,
                    items: dedupe(items),
                };
            },
        }
    )
);


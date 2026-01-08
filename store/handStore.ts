import { create } from "zustand";

export type HandItem =
    | { kind: "card"; id: string }
    | { kind: "deck"; id: string };

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
    clear: () => void;
};

function same(a: HandItem, b: HandItem) {
    return a.kind === b.kind && a.id === b.id;
}

export const useHandStore = create<HandState>((set, get) => ({
    items: [],
    isOpen: false,

    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

    has: (item) => get().items.some((x) => same(x, item)),
    add: (item) =>
        set((s) => (s.items.some((x) => same(x, item)) ? s : { items: [...s.items, item] })),
    remove: (item) => set((s) => ({ items: s.items.filter((x) => !same(x, item)) })),
    toggle: (item) => (get().has(item) ? get().remove(item) : get().add(item)),
    clear: () => set({ items: [] }),
}));

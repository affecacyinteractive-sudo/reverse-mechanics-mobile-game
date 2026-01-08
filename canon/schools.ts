// canon/schools.ts
export type Domain = "SOFTWARE" | "STORY";

export const SCHOOL_META: Record<
    string,
    { domain: Domain; name: string; order: number }
    > = {
    // Software Deck schools
    FI: { domain: "SOFTWARE", name: "Introduction", order: 10 },
    FU: { domain: "SOFTWARE", name: "Understanding", order: 20 },
    FPR: { domain: "SOFTWARE", name: "Presentation", order: 30 },
    FA: { domain: "SOFTWARE", name: "Abstraction", order: 40 },
    FS: { domain: "SOFTWARE", name: "Synthesis", order: 50 },
    FP: { domain: "SOFTWARE", name: "Planning", order: 60 },

    // Story Deck schools
    SF: { domain: "STORY", name: "Foundations", order: 10 },
    SE: { domain: "STORY", name: "Entities", order: 20 },
    SD: { domain: "STORY", name: "Dynamics", order: 30 },
    SS: { domain: "STORY", name: "Scenarios", order: 40 },
    SX: { domain: "STORY", name: "Expression", order: 50 },
    SRC: { domain: "STORY", name: "Reuse Catalog", order: 60 },
};

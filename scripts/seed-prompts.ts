// scripts/seed-prompts.ts
import "dotenv/config";
import { eq } from "drizzle-orm";

import { db, pool } from "../db";
import { cards } from "../db/schema";

type PromptSeed = {
    canonId: string; // stable seed id
    anchor: string;
    body: string;
};

const PROMPTS: PromptSeed[] = [
    {
        canonId: "P-EXEC-01",
        anchor: "Build Prototype",
        body:
            "Use the current evolving story and selected targets to build the next incremental web app feature. Prefer small, composable changes. Produce collectible chunks.",
    },
    {
        canonId: "P-EXEC-02",
        anchor: "Add Endpoint",
        body:
            "Extend the existing app with a small API route or server action that matches the story logic. Keep it minimal, typed, and testable.",
    },
    {
        canonId: "P-EXEC-03",
        anchor: "Refactor UI",
        body:
            "Improve the UI component structure for mobile. Keep it minimal, consistent, and focused on card mechanics. Avoid large rewrites.",
    },
    {
        canonId: "P-EXEC-04",
        anchor: "Tighten Types",
        body:
            "Increase TypeScript strictness in the new code you add. Prefer small Zod schemas for IO boundaries. Keep changes incremental.",
    },
    {
        canonId: "P-EXEC-05",
        anchor: "Story Driven",
        body:
            "Let the supernatural story constraints drive the next software change. Keep it whimsical but still practical for a web prototype.",
    },
];

async function upsertPrompt(seed: PromptSeed) {
    const found = await db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.canonId, seed.canonId))
        .limit(1);

    const row = {
        sessionId: null,          // global library prompt
        kind: "PROMPT" as const,
        zone: "LIBRARY" as const,
        domain: "NONE" as const,

        canonId: seed.canonId,
        schoolCode: null,
        schoolName: null,

        anchor: seed.anchor,
        body: seed.body,

        isCommitted: false,
        isImmutable: false,

        meta: {
            prompt_type: "EXECUTION",
            seed: true,
        },
    };

    if (found.length === 0) {
        await db.insert(cards).values(row as any);
        return "inserted";
    }

    await db.update(cards).set(row as any).where(eq(cards.canonId, seed.canonId));
    return "updated";
}

async function main() {
    let inserted = 0;
    let updated = 0;

    for (const p of PROMPTS) {
        const res = await upsertPrompt(p);
        if (res === "inserted") inserted++;
        else updated++;
    }

    console.log("Seed prompts done.", { inserted, updated });
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

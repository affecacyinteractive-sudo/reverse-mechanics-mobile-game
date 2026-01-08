// scripts/seed.ts
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db, pool } from "../db";
import { sessions, cards } from "../db/schema";

/**
 * This seed script is updated for the new ACTION taxonomy shape:
 * - Two action decks (domain): SOFTWARE / STORY
 * - Optional schoolCode + schoolName (for canon actions)
 *
 * For now we seed ONLY the two Global Executors as immutable ACTION cards in the Library.
 * They are "global" and may not belong to a specific school yet, so schoolCode/schoolName are left null.
 *
 * IMPORTANT: Put these prompt files in your repo at:
 *   canon/prompts/global-software-executor.txt
 *   canon/prompts/global-story-executor.txt
 */
async function readPrompt(relPathFromRepoRoot: string) {
    const abs = path.join(process.cwd(), relPathFromRepoRoot);
    return fs.readFile(abs, "utf8");
}

async function ensureDemoSession(): Promise<string> {
    const existing = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.title, "Demo Session"))
        .limit(1);

    if (existing.length > 0) return existing[0].id;

    const created = await db
        .insert(sessions)
        .values({ title: "Demo Session" })
        .returning({ id: sessions.id });

    return created[0].id;
}

async function upsertImmutableActionCard(input: {
    canonId: string; // stable id for seeding/upsert
    domain: "SOFTWARE" | "STORY";
    anchor: string;
    body: string;
    meta: Record<string, unknown>;
}) {
    const found = await db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.canonId, input.canonId))
        .limit(1);

    if (found.length === 0) {
        await db.insert(cards).values({
            sessionId: null, // global library
            kind: "ACTION",
            zone: "LIBRARY",
            domain: input.domain,

            canonId: input.canonId,
            schoolCode: null,
            schoolName: null,

            anchor: input.anchor,
            body: input.body,

            isCommitted: false,
            isImmutable: true,
            meta: input.meta,
        });
        return { action: "inserted" as const };
    }

    // Keep immutable actions in sync with latest file contents (safe overwrite).
    await db
        .update(cards)
        .set({
            domain: input.domain,
            zone: "LIBRARY",
            anchor: input.anchor,
            body: input.body,
            isImmutable: true,
            meta: input.meta,
        })
        .where(eq(cards.canonId, input.canonId));

    return { action: "updated" as const };
}

async function main() {
    const sessionId = await ensureDemoSession();

    const softwareExecutor = await readPrompt(
        "canon/prompts/global-software-executor.txt"
    );
    const storyExecutor = await readPrompt(
        "canon/prompts/global-story-executor.txt"
    );

    const results = [];

    results.push(
        await upsertImmutableActionCard({
            canonId: "GSE-SW",
            domain: "SOFTWARE",
            anchor: "Software Executor",
            body: softwareExecutor,
            meta: { action_id: "GLOBAL_SOFTWARE_EXECUTOR", is_global_executor: true, v: 1 },
        })
    );

    results.push(
        await upsertImmutableActionCard({
            canonId: "GSE-ST",
            domain: "STORY",
            anchor: "Story Executor",
            body: storyExecutor,
            meta: { action_id: "GLOBAL_STORY_EXECUTOR", is_global_executor: true, v: 1 },
        })
    );

    console.log("Seed complete.");
    console.log("Demo Session ID:", sessionId);
    console.log("Actions:", results);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

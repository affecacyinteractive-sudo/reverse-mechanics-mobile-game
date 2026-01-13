/* scripts/cleanup-library-prompts.ts */
import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db"; // ✅ adjust if your db export path differs
import { cards, sessions } from "../db/schema"; // ✅ adjust if needed

function arg(name: string) {
    const idx = process.argv.findIndex((a) => a === name);
    if (idx === -1) return null;
    return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string) {
    return process.argv.includes(name);
}

function preview(s: string, n = 90) {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
}

async function getLatestSessionId() {
    const row = await db
        .select({ id: sessions.id })
        .from(sessions)
        .orderBy(desc(sessions.createdAt))
        .limit(1);

    return row[0]?.id ?? null;
}

async function main() {
    const yes = hasFlag("--yes");
    const force = hasFlag("--force");
    const sessionArg = arg("--session");

    const sessionId = sessionArg ?? (await getLatestSessionId());
    if (!sessionId) {
        console.log("No sessions found. Nothing to clean.");
        process.exit(0);
    }

    const libraryPrompts = await db
        .select({
            id: cards.id,
            anchor: cards.anchor,
            body: cards.body,
            createdAt: cards.createdAt,
        })
        .from(cards)
        .where(
            and(
                eq(cards.sessionId, sessionId),
                eq(cards.zone, "LIBRARY"),
                eq(cards.kind, "PROMPT")
            )
        )
        .orderBy(desc(cards.createdAt));

    console.log("Library PROMPT cleanup preflight:");
    console.log({ sessionId, dryRun: !yes, found: libraryPrompts.length });

    if (libraryPrompts.length) {
        console.table(
            libraryPrompts.map((p) => ({
                id: p.id,
                anchor: p.anchor,
                body: preview(p.body),
                createdAt: String(p.createdAt),
            }))
        );
    }

    // Safety: if we unexpectedly find a lot, require --force
    if (libraryPrompts.length > 20 && !force) {
        console.log(
            `\nRefusing to delete ${libraryPrompts.length} library prompts without --force.\n` +
            `If you're sure, run:\n  npx tsx scripts/cleanup-library-prompts.ts --yes --force\n`
        );
        process.exit(1);
    }

    if (!yes) {
        console.log(
            `\nDry-run only. To delete these library prompts:\n` +
            `  npx tsx scripts/cleanup-library-prompts.ts --yes\n` +
            (sessionArg ? "" : `\n(Defaults to latest session. Use --session <id> to target another.)\n`)
        );
        process.exit(0);
    }

    const ids = libraryPrompts.map((p) => p.id);
    if (ids.length === 0) {
        console.log("No library prompts found. Done.");
        process.exit(0);
    }

    const deleted = await db.transaction(async (tx) => {
        const rows = await tx
            .delete(cards)
            .where(
                and(
                    eq(cards.sessionId, sessionId),
                    eq(cards.zone, "LIBRARY"),
                    eq(cards.kind, "PROMPT")
                )
            )
            .returning({ id: cards.id });
        return rows.length;
    });

    console.log("\nDeleted library prompts:", deleted);

    console.log(
        "\nReminder: if any of these were in Hand/Board, clear localStorage to remove stale references:\n" +
        "  localStorage.clear(); location.reload();\n"
    );
}

main().catch((e) => {
    console.error("Cleanup failed:", e?.message ?? e);
    process.exit(1);
});

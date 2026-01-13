import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db"; // adjust if needed
import { cards } from "../db/schema"; // adjust if needed

function hasFlag(name: string) {
    return process.argv.includes(name);
}

function preview(s: string, n = 110) {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
}

async function main() {
    const yes = hasFlag("--yes");
    const force = hasFlag("--force");

    const rows = await db
        .select({
            id: cards.id,
            sessionId: cards.sessionId,
            anchor: cards.anchor,
            body: cards.body,
            createdAt: cards.createdAt,
        })
        .from(cards)
        .where(and(eq(cards.zone, "LIBRARY"), eq(cards.kind, "PROMPT")))
        .orderBy(desc(cards.createdAt));

    console.log("Found LIBRARY PROMPT cards (all sessions):", rows.length);
    if (rows.length) {
        console.table(
            rows.map((r) => ({
                id: r.id,
                sessionId: r.sessionId,
                anchor: r.anchor,
                body: preview(r.body),
                createdAt: String(r.createdAt),
            }))
        );
    }

    // Safety: if there are many, require --force
    if (rows.length > 20 && !force) {
        console.log(
            `\nRefusing to delete ${rows.length} rows without --force.\n` +
            `If you're sure:\n  npx tsx scripts/cleanup-library-prompts-all.ts --yes --force\n`
        );
        process.exit(1);
    }

    if (!yes) {
        console.log(
            `\nDry-run only.\nTo delete ALL Library PROMPT cards across all sessions:\n` +
            `  npx tsx scripts/cleanup-library-prompts-all.ts --yes\n`
        );
        process.exit(0);
    }

    const deleted = await db
        .delete(cards)
        .where(and(eq(cards.zone, "LIBRARY"), eq(cards.kind, "PROMPT")))
        .returning({ id: cards.id });

    console.log("\nDeleted:", deleted.length);

    console.log(
        "\nIf the UI still shows them, do BOTH:\n" +
        "1) restart `next dev`\n" +
        "2) clear localStorage (Hand/Board/session pins) then reload:\n" +
        "   localStorage.clear(); location.reload();\n"
    );
}

main().catch((e) => {
    console.error("Cleanup failed:", e?.message ?? e);
    process.exit(1);
});

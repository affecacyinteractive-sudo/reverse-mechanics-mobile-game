/* scripts/cleanup.ts */
import "dotenv/config";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../db"; // ✅ adjust if your db export path differs
import { cards, deckCards, decks, sessions } from "../db/schema"; // ✅ adjust if needed

type Mode = "gen" | "gen+drafts" | "hard";

function arg(name: string) {
    const idx = process.argv.findIndex((a) => a === name);
    if (idx === -1) return null;
    return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string) {
    return process.argv.includes(name);
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
    const mode = ((arg("--mode") ?? "gen+drafts") as Mode) || "gen+drafts";
    const yes = hasFlag("--yes");
    const sessionArg = arg("--session");

    const sessionId = sessionArg ?? (await getLatestSessionId());
    if (!sessionId) {
        console.log("No sessions found. Nothing to clean.");
        process.exit(0);
    }

    // --- Preflight counts (dry-run summary) ---
    const generatedDeckRows = await db
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.sessionId, sessionId), eq(decks.zone, "GENERATED")));

    const generatedDeckIds = generatedDeckRows.map((d) => d.id);

    const generatedCardRows = await db
        .select({ id: cards.id })
        .from(cards)
        .where(and(eq(cards.sessionId, sessionId), eq(cards.zone, "GENERATED")));

    const workshopDraftRows = await db
        .select({ id: cards.id })
        .from(cards)
        .where(
            and(eq(cards.sessionId, sessionId), eq(cards.zone, "WORKSHOP"), eq(cards.isDraft, true))
        );

    const workshopAllRows = await db
        .select({ id: cards.id })
        .from(cards)
        .where(and(eq(cards.sessionId, sessionId), eq(cards.zone, "WORKSHOP")));

    const deckCardRows =
        generatedDeckIds.length === 0
            ? []
            : await db
                .select({ deckId: deckCards.deckId, cardId: deckCards.cardId })
                .from(deckCards)
                .where(inArray(deckCards.deckId, generatedDeckIds));

    console.log("Cleanup preflight:");
    console.log({ sessionId, mode, dryRun: !yes });
    console.log({
        generatedDecks: generatedDeckIds.length,
        generatedCards: generatedCardRows.length,
        generatedDeckCards: deckCardRows.length,
        workshopDrafts: workshopDraftRows.length,
        workshopAll: workshopAllRows.length,
    });

    if (!yes) {
        console.log(
            '\nDry-run only. Re-run with "--yes" to execute.\nExample:\n  npx tsx scripts/cleanup.ts --mode gen+drafts --yes\n'
        );
        process.exit(0);
    }

    // --- Execute cleanup in a transaction ---
    const result = await db.transaction(async (tx) => {
        // Re-fetch deck ids inside txn
        const deckRows = await tx
            .select({ id: decks.id })
            .from(decks)
            .where(and(eq(decks.sessionId, sessionId), eq(decks.zone, "GENERATED")));

        const deckIds = deckRows.map((d) => d.id);

        let deletedDeckCards = 0;
        if (deckIds.length) {
            const deleted = await tx
                .delete(deckCards)
                .where(inArray(deckCards.deckId, deckIds))
                .returning({ deckId: deckCards.deckId });
            deletedDeckCards = deleted.length;
        }

        const deletedGeneratedCards = await tx
            .delete(cards)
            .where(and(eq(cards.sessionId, sessionId), eq(cards.zone, "GENERATED")))
            .returning({ id: cards.id });

        let deletedGeneratedDecks = 0;
        if (deckIds.length) {
            const deleted = await tx
                .delete(decks)
                .where(inArray(decks.id, deckIds))
                .returning({ id: decks.id });
            deletedGeneratedDecks = deleted.length;
        }

        let deletedWorkshopDrafts = 0;
        let deletedWorkshopAll = 0;

        if (mode === "gen+drafts") {
            const deleted = await tx
                .delete(cards)
                .where(
                    and(eq(cards.sessionId, sessionId), eq(cards.zone, "WORKSHOP"), eq(cards.isDraft, true))
                )
                .returning({ id: cards.id });
            deletedWorkshopDrafts = deleted.length;
        }

        if (mode === "hard") {
            const deleted = await tx
                .delete(cards)
                .where(and(eq(cards.sessionId, sessionId), eq(cards.zone, "WORKSHOP")))
                .returning({ id: cards.id });
            deletedWorkshopAll = deleted.length;
        }

        return {
            sessionId,
            deletedDeckCards,
            deletedGeneratedCards: deletedGeneratedCards.length,
            deletedGeneratedDecks,
            deletedWorkshopDrafts,
            deletedWorkshopAll,
        };
    });

    console.log("\nCleanup executed:");
    console.log(result);

    console.log(
        "\nReminder: Hand/Board state is stored in browser localStorage. To fully reset UI state:\n" +
        "  localStorage.clear(); location.reload();\n"
    );
}

main().catch((e) => {
    console.error("Cleanup failed:", e?.message ?? e);
    process.exit(1);
});

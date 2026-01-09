// scripts/seed-generated.ts
import "dotenv/config";
import { eq, and, isNull } from "drizzle-orm";

import { db, pool } from "../db";
import { sessions, decks, cards, deckCards } from "../db/schema";

async function ensureDemoSession(): Promise<string> {
    const existing = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.title, "Demo Session"))
        .limit(1);

    if (existing.length) return existing[0].id;

    const created = await db
        .insert(sessions)
        .values({ title: "Demo Session" })
        .returning({ id: sessions.id });

    return created[0].id;
}

async function deckExists(sessionId: string, title: string) {
    const rows = await db
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.sessionId, sessionId), eq(decks.zone, "GENERATED"), eq(decks.title, title)))
        .limit(1);
    return rows[0]?.id ?? null;
}

type OutputSeed = {
    canonId: string;
    domain: "SOFTWARE" | "STORY" | "NONE";
    anchor: string;
    body: string;
    meta: Record<string, unknown>;
};

async function createGeneratedDeck(sessionId: string, title: string, outputs: OutputSeed[]) {
    const deck = await db
        .insert(decks)
        .values({
            sessionId,
            zone: "GENERATED",
            title,
            meta: { seed: true },
        })
        .returning({ id: decks.id });

    const deckId = deck[0].id;

    // Insert cards
    const inserted = await db
        .insert(cards)
        .values(
            outputs.map((o) => ({
                sessionId,
                kind: "OUTPUT",
                zone: "GENERATED",
                domain: o.domain,

                canonId: o.canonId,
                schoolCode: null,
                schoolName: null,

                anchor: o.anchor,
                body: o.body,

                isCommitted: false,
                isImmutable: false,

                meta: o.meta,
            }))
        )
        .returning({ id: cards.id });

    // Link to deck with positions
    await db.insert(deckCards).values(
        inserted.map((row, i) => ({
            deckId,
            cardId: row.id,
            position: i,
        }))
    );

    return deckId;
}

async function main() {
    const sessionId = await ensureDemoSession();

    // Skip if already seeded once (by title)
    const d1Title = "Dummy Deck Alpha";
    const d2Title = "Dummy Deck Beta";

    const existing1 = await deckExists(sessionId, d1Title);
    const existing2 = await deckExists(sessionId, d2Title);

    if (!existing1) {
        await createGeneratedDeck(sessionId, d1Title, [
            {
                canonId: "DOUT-A-01",
                domain: "STORY",
                anchor: "Moon Oath",
                body:
                    "The moon demands daily rituals. Each completed ritual reduces chaos in the workshop by one notch.",
                meta: { chunk_type: "text", tag: "story" },
            },
            {
                canonId: "DOUT-A-02",
                domain: "SOFTWARE",
                anchor: "Card Layout",
                body:
                    "We need a horizontal deck layout with snap scrolling and a details drawer for each card.",
                meta: { chunk_type: "text", tag: "software" },
            },
            {
                canonId: "DOUT-A-03",
                domain: "SOFTWARE",
                anchor: "Deck Scroller",
                body: `// Example: a tiny horizontal scroller pattern for mobile
export function DeckRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2">
      {children}
    </div>
  );
}
`,
                meta: { chunk_type: "code", tag: "software", language: "ts" },
            },
            {
                canonId: "DOUT-A-04",
                domain: "STORY",
                anchor: "Feral Rule",
                body:
                    "No spell may repeat its own words. The world punishes duplicated incantations with sudden fog.",
                meta: { chunk_type: "text", tag: "story" },
            },
            {
                canonId: "DOUT-A-05",
                domain: "SOFTWARE",
                anchor: "Chunk Schema",
                body:
                    "Outputs must be small chunks. Code chunks always link to a preceding text chunk by id.",
                meta: { chunk_type: "text", tag: "software" },
            },
            {
                canonId: "DOUT-A-06",
                domain: "SOFTWARE",
                anchor: "Parser Sketch",
                body: `type Chunk = 
  | { id: string; type: "text"; anchor: string; body: string }
  | { id: string; type: "code"; anchor: string; body: string; link: string };

export function parseOutput(json: unknown): Chunk[] {
  // placeholder: validate with Zod later
  if (!json || typeof json !== "object") return [];
  const chunks = (json as any).chunks;
  return Array.isArray(chunks) ? (chunks as Chunk[]) : [];
}
`,
                meta: { chunk_type: "code", tag: "software", language: "ts" },
            },
        ]);
        console.log("Seeded:", d1Title);
    } else {
        console.log("Exists, skipped:", d1Title, existing1);
    }

    if (!existing2) {
        await createGeneratedDeck(sessionId, d2Title, [
            {
                canonId: "DOUT-B-01",
                domain: "STORY",
                anchor: "Ash Market",
                body:
                    "A market of ash trades memories for interfaces. Every new UI control costs a small secret.",
                meta: { chunk_type: "text", tag: "story" },
            },
            {
                canonId: "DOUT-B-02",
                domain: "SOFTWARE",
                anchor: "Board Slots",
                body:
                    "The board has Targets (many), Action (one), Prompt (one). Placement must be deliberate.",
                meta: { chunk_type: "text", tag: "software" },
            },
            {
                canonId: "DOUT-B-03",
                domain: "SOFTWARE",
                anchor: "Event Idea",
                body:
                    "Log operations as events; store current-state separately. Use minimal payloads until the LLM loop is stable.",
                meta: { chunk_type: "text", tag: "software" },
            },
            {
                canonId: "DOUT-B-04",
                domain: "STORY",
                anchor: "Witness Clause",
                body:
                    "Any tool may be used only if witnessed by a named entity. Unwitnessed work collapses into static.",
                meta: { chunk_type: "text", tag: "story" },
            },
        ]);
        console.log("Seeded:", d2Title);
    } else {
        console.log("Exists, skipped:", d2Title, existing2);
    }

    console.log("Done. Demo Session:", sessionId);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

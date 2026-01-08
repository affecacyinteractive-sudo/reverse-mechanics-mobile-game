// scripts/seed-actions.ts
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db, pool } from "../db";
import { cards } from "../db/schema";
import { SCHOOL_META } from "../canon/schools";

type ActionSeed = {
    canonId: string;     // e.g. "FP-01"
    schoolCode: string;  // e.g. "FP"
    domain: "SOFTWARE" | "STORY";
    schoolName: string;
    anchor: string;      // short title (we’ll default to canonId)
    body: string;
};

function parseCanonId(filename: string) {
    const base = filename.replace(/\.txt$/i, "");
    // Accept FP-01, SD-08, SRC-02, etc.
    if (!/^[A-Z]+-\d+$/i.test(base)) return null;
    return base.toUpperCase();
}

function canonToSchoolCode(canonId: string) {
    // "SRC-01" -> "SRC", "FP-01" -> "FP"
    return canonId.split("-")[0].toUpperCase();
}

async function walkTxtFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walkTxtFiles(full)));
        else if (e.isFile() && e.name.toLowerCase().endsWith(".txt")) out.push(full);
    }
    return out;
}

async function upsertActionCard(seed: ActionSeed) {
    const existing = await db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.canonId, seed.canonId))
        .limit(1);

    const row = {
        sessionId: null, // global library
        kind: "ACTION" as const,
        zone: "LIBRARY" as const,

        domain: seed.domain,

        canonId: seed.canonId,
        schoolCode: seed.schoolCode as any,
        schoolName: seed.schoolName,

        anchor: seed.anchor,
        body: seed.body,

        isCommitted: false,
        isImmutable: true,
        meta: { action_id: seed.canonId }, // simple stable id
    };

    if (existing.length === 0) {
        await db.insert(cards).values(row as any);
        return "inserted";
    }

    await db.update(cards).set(row as any).where(eq(cards.canonId, seed.canonId));
    return "updated";
}

async function main() {
    const dir = process.env.ACTION_PROMPTS_DIR || "canon/prompts/actions";
    const filter = process.env.ACTION_SEED_FILTER || "";
    // Example: ACTION_SEED_FILTER="^(FP|FI|SF)-"
    const filterRe = filter ? new RegExp(filter, "i") : null;

    const files = await walkTxtFiles(path.join(process.cwd(), dir));

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const warnings: string[] = [];

    for (const file of files) {
        const canonId = parseCanonId(path.basename(file));
        if (!canonId) {
            skipped++;
            continue;
        }
        if (filterRe && !filterRe.test(canonId)) {
            skipped++;
            continue;
        }

        const schoolCode = canonToSchoolCode(canonId);
        const meta = SCHOOL_META[schoolCode];
        if (!meta) {
            warnings.push(`No SCHOOL_META mapping for schoolCode=${schoolCode} (${canonId})`);
            skipped++;
            continue;
        }

        const body = await fs.readFile(file, "utf8");

        const res = await upsertActionCard({
            canonId,
            schoolCode,
            domain: meta.domain,
            schoolName: meta.name,
            anchor: canonId, // keep it simple for now; you can add real titles later
            body,
        });

        if (res === "inserted") inserted++;
        else updated++;
    }

    console.log("Seed actions done.");
    console.log({ inserted, updated, skipped });
    if (warnings.length) {
        console.log("Warnings:");
        for (const w of warnings) console.log("-", w);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });

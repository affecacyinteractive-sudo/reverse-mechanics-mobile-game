// // stitch-actions.js
// // Usage: node stitch-actions.js [outputFile]
// // Default output: stitched-actions.txt
//
// const fs = require("fs/promises");
// const path = require("path");
//
// async function main() {
//     const actionsDir = path.resolve(process.cwd(), "actions-candidates");
//     const outPath = path.resolve(process.cwd(), process.argv[2] || "stitched-actions.txt");
//
//     // Read folder
//     let entries;
//     try {
//         entries = await fs.readdir(actionsDir, { withFileTypes: true });
//     } catch (e) {
//         console.error(`Could not read folder: ${actionsDir}`);
//         console.error(e.message);
//         process.exit(1);
//     }
//
//     // Pick files (change filter if you want non-.txt too)
//     const files = entries
//         .filter((d) => d.isFile())
//         .map((d) => d.name)
//         .filter((name) => name.toLowerCase().endsWith(".txt"))
//         .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
//
//     if (files.length === 0) {
//         console.error(`No .txt files found in: ${actionsDir}`);
//         process.exit(1);
//     }
//
//     const chunks = [];
//
//     for (const name of files) {
//         const fullPath = path.join(actionsDir, name);
//         const content = await fs.readFile(fullPath, "utf8");
//
//         chunks.push(
//             `===== BEGIN: ${name} =====\n` +
//             content.replace(/\s*$/, "") + // trim trailing whitespace/newlines
//             `\n===== END:   ${name} =====\n`
//         );
//     }
//
//     // Add a blank line between files
//     const stitched = chunks.join("\n");
//
//     await fs.writeFile(outPath, stitched, "utf8");
//     console.log(`Wrote ${files.length} files into: ${outPath}`);
// }
//
// main().catch((err) => {
//     console.error(err);
//     process.exit(1);
// });

// stitch-actions.js
// Usage: node stitch-actions.js [outputFile]
// Default output: stitched-actions.txt

const fs = require("fs/promises");
const path = require("path");

async function listTxtFilesRecursive(rootDir) {
    const out = [];

    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (e) {
            // If a subfolder is missing / unreadable, just skip it.
            console.warn(`Skipping unreadable folder: ${dir}`);
            return;
        }

        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                await walk(full);
            } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".txt")) {
                out.push(full);
            }
        }
    }

    await walk(rootDir);
    return out;
}

function rel(p, base) {
    return path.relative(base, p).replace(/\\/g, "/");
}

function fileSortKey(fullPath) {
    // Prefer sorting by the action code if present (FI-01, FU-03, etc.)
    const base = path.basename(fullPath);
    const m = base.match(/^(FI|FU|FPR|FP|FA|FS)-(\d+)/i);
    if (m) {
        const school = m[1].toUpperCase();
        const num = String(parseInt(m[2], 10)).padStart(3, "0");
        return `${school}-${num}::${base.toLowerCase()}`;
    }
    return `ZZZ::${base.toLowerCase()}`;
}

async function main() {
    const actionsDir = path.resolve(process.cwd(), "actions-best");
    const outPath = path.resolve(process.cwd(), process.argv[2] || "stitched-actions-best.txt");

    // Discover all .txt files under actions-better/* (recursive)
    let files;
    try {
        files = await listTxtFilesRecursive(actionsDir);
    } catch (e) {
        console.error(`Could not read folder: ${actionsDir}`);
        console.error(e.message);
        process.exit(1);
    }

    if (files.length === 0) {
        console.error(`No .txt files found under: ${actionsDir}`);
        process.exit(1);
    }

    // Sort by action code when possible, otherwise by basename
    files.sort((a, b) => fileSortKey(a).localeCompare(fileSortKey(b), undefined, { numeric: true }));

    const chunks = [];

    for (const fullPath of files) {
        const content = await fs.readFile(fullPath, "utf8");
        const label = rel(fullPath, actionsDir);

        chunks.push(
            `===== BEGIN: ${label} =====\n` +
            content.replace(/\s*$/, "") + // trim trailing whitespace/newlines
            `\n===== END:   ${label} =====\n`
        );
    }

    // Blank line between files
    const stitched = chunks.join("\n");

    await fs.writeFile(outPath, stitched, "utf8");
    console.log(`Wrote ${files.length} files into: ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
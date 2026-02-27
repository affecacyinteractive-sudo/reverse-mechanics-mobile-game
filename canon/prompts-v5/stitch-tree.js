// stitch-tree.js
// Usage: node stitch-tree.js [rootDir] [outputFile]
// Defaults: rootDir="." outputFile="stitched-tree.txt"
//
// Traverses the folder tree under rootDir and stitches every .txt file.
// Each file is wrapped with BEGIN/END markers that include the folder path.
// Sorting is stable: folders lexicographic, files lexicographic (numeric-aware).

const fs = require("fs/promises");
const path = require("path");

function toPosix(p) {
    return p.replace(/\\/g, "/");
}

function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function walkTxtFiles(rootDir) {
    const files = [];

    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (e) {
            console.warn(`Skipping unreadable folder: ${dir}`);
            return;
        }

        // Sort to ensure deterministic traversal
        entries.sort((a, b) => naturalCompare(a.name, b.name));

        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                await walk(full);
            } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".txt")) {
                files.push(full);
            }
        }
    }

    await walk(rootDir);
    return files;
}

async function main() {
    const rootDir = path.resolve(process.cwd(), process.argv[2] || ".");
    const outPath = path.resolve(process.cwd(), process.argv[3] || "stitched-tree.txt");

    const files = await walkTxtFiles(rootDir);

    if (files.length === 0) {
        console.error(`No .txt files found under: ${rootDir}`);
        process.exit(1);
    }

    const chunks = [];
    for (const fullPath of files) {
        const content = await fs.readFile(fullPath, "utf8");
        const rel = toPosix(path.relative(rootDir, fullPath));

        // Folder levels are implicit in `rel` (e.g. "actions-better/understanding/FU-03.txt")
        // This makes the stitch output "against the folder levels".
        chunks.push(
            `===== BEGIN: ${rel} =====\n` +
            content.replace(/\s*$/, "") +
            `\n===== END:   ${rel} =====\n`
        );
    }

    await fs.writeFile(outPath, chunks.join("\n"), "utf8");
    console.log(`Wrote ${files.length} files into: ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
// stitch-tree.js
// Usage: node stitch-tree.js [rootDir] [outputFile]
// Defaults: rootDir="." outputFile="stitched-tree.txt"
//
// Traverses the folder tree under rootDir and stitches every .txt file,
// but labels/sections IGNORE the root folder (only show path *below* rootDir).

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

        // This is the "ignore root folder" part:
        // label is ONLY the path beneath rootDir, never including rootDir itself.
        let label = toPosix(path.relative(rootDir, fullPath));

        // If someone passes the file directly and it's exactly rootDir, keep a sane label
        if (!label || label === "." || label === "./") {
            label = path.basename(fullPath);
        }

        chunks.push(
            `===== BEGIN: ${label} =====\n` +
            content.replace(/\s*$/, "") +
            `\n===== END:   ${label} =====\n`
        );
    }

    await fs.writeFile(outPath, chunks.join("\n"), "utf8");
    console.log(`Wrote ${files.length} files into: ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
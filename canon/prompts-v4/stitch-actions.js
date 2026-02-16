// stitch-actions.js
// Usage: node stitch-actions.js [outputFile]
// Default output: stitched-actions.txt

const fs = require("fs/promises");
const path = require("path");

async function main() {
    const actionsDir = path.resolve(process.cwd(), "actions");
    const outPath = path.resolve(process.cwd(), process.argv[2] || "stitched-actions.txt");

    // Read folder
    let entries;
    try {
        entries = await fs.readdir(actionsDir, { withFileTypes: true });
    } catch (e) {
        console.error(`Could not read folder: ${actionsDir}`);
        console.error(e.message);
        process.exit(1);
    }

    // Pick files (change filter if you want non-.txt too)
    const files = entries
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .filter((name) => name.toLowerCase().endsWith(".txt"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

    if (files.length === 0) {
        console.error(`No .txt files found in: ${actionsDir}`);
        process.exit(1);
    }

    const chunks = [];

    for (const name of files) {
        const fullPath = path.join(actionsDir, name);
        const content = await fs.readFile(fullPath, "utf8");

        chunks.push(
            `===== BEGIN: ${name} =====\n` +
            content.replace(/\s*$/, "") + // trim trailing whitespace/newlines
            `\n===== END:   ${name} =====\n`
        );
    }

    // Add a blank line between files
    const stitched = chunks.join("\n");

    await fs.writeFile(outPath, stitched, "utf8");
    console.log(`Wrote ${files.length} files into: ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

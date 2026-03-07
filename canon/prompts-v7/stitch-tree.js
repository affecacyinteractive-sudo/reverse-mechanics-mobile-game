// stitch-tree.js
// Usage:
//   node stitch-tree.js [rootDir] [outputFile] [--follow-symlinks] [--dump-list=files.txt] [--ext=txt,ts]
//
// Defaults:
//   rootDir="." outputFile="stitched-tree.txt" exts="txt,ts"
//
// - Recurses into all subfolders under rootDir.
// - By default, does NOT follow symlinked directories (use --follow-symlinks).
// - Labels ignore the rootDir (paths shown are relative to rootDir).

const fs = require("fs/promises");
const path = require("path");

function toPosix(p) {
    return p.replace(/\\/g, "/");
}

function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function parseArgs(argv) {
    const opts = {
        rootDir: argv[2] || ".",
        outFile: argv[3] || "stitched-tree.txt",
        followSymlinks: false,
        dumpList: null,
        exts: new Set(["txt", "ts"]), // <-- default now includes ts
    };

    for (const a of argv.slice(4)) {
        if (a === "--follow-symlinks") opts.followSymlinks = true;
        else if (a.startsWith("--dump-list=")) opts.dumpList = a.split("=", 2)[1] || null;
        else if (a.startsWith("--ext=")) {
            const raw = a.split("=", 2)[1] || "txt,ts";
            opts.exts = new Set(
                raw
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean)
            );
        }
    }
    return opts;
}

function hasWantedExt(filename, exts) {
    const lower = filename.toLowerCase();
    for (const ext of exts) {
        if (lower.endsWith("." + ext)) return true;
    }
    return false;
}

async function walkFiles(rootDir, { followSymlinks, exts }) {
    const files = [];
    const skippedDirs = [];
    let dirsVisited = 0;

    async function walk(dir) {
        dirsVisited++;

        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (e) {
            skippedDirs.push({ dir, reason: e.message });
            return;
        }

        entries.sort((a, b) => naturalCompare(a.name, b.name));

        for (const ent of entries) {
            const full = path.join(dir, ent.name);

            if (ent.isDirectory()) {
                await walk(full);
                continue;
            }

            // Optional: follow symlinked directories/files
            if (followSymlinks && ent.isSymbolicLink()) {
                try {
                    const st = await fs.stat(full); // follows link
                    if (st.isDirectory()) {
                        await walk(full);
                        continue;
                    }
                    if (st.isFile() && hasWantedExt(ent.name, exts)) {
                        files.push(full);
                        continue;
                    }
                } catch {
                    // ignore broken symlinks
                }
            }

            if (ent.isFile() && hasWantedExt(ent.name, exts)) {
                files.push(full);
            }
        }
    }

    await walk(rootDir);
    return { files, dirsVisited, skippedDirs };
}

async function main() {
    const opts = parseArgs(process.argv);

    const rootDir = path.resolve(process.cwd(), opts.rootDir);
    const outPath = path.resolve(process.cwd(), opts.outFile);

    const { files, dirsVisited, skippedDirs } = await walkFiles(rootDir, opts);

    if (files.length === 0) {
        console.error(`No matching files found under: ${rootDir} (exts: ${[...opts.exts].join(",")})`);
        process.exit(1);
    }

    // deterministic: sort by relative path (natural)
    const rels = files
        .map((f) => ({ full: f, rel: toPosix(path.relative(rootDir, f)) }))
        .sort((a, b) => naturalCompare(a.rel, b.rel));

    const chunks = [];
    const listLines = [];

    for (const { full, rel } of rels) {
        const content = await fs.readFile(full, "utf8");
        const label = rel && rel !== "." ? rel : path.basename(full);

        listLines.push(label);

        chunks.push(
            `===== BEGIN: ${label} =====\n` +
            content.replace(/\s*$/, "") +
            `\n===== END:   ${label} =====\n`
        );
    }

    await fs.writeFile(outPath, chunks.join("\n"), "utf8");

    if (opts.dumpList) {
        const dumpPath = path.resolve(process.cwd(), opts.dumpList);
        await fs.writeFile(dumpPath, listLines.join("\n") + "\n", "utf8");
        console.log(`Wrote file list to: ${dumpPath}`);
    }

    console.log(`Dirs visited: ${dirsVisited}`);
    console.log(`Files stitched: ${rels.length} (exts: ${[...opts.exts].join(",")})`);
    console.log(`Output: ${outPath}`);

    if (skippedDirs.length) {
        console.warn(`Skipped unreadable dirs (${skippedDirs.length}):`);
        for (const s of skippedDirs) console.warn(`- ${s.dir} :: ${s.reason}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
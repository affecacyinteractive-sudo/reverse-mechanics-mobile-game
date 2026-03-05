// tool-check.ts
// Deterministic optional step: run build/lint/test commands against a prepared workspace.
// Assumes the proposed code changes have already been applied to `workspace_dir`.
// If any command fails, returns exactly one SEAL chunk (TEXT) to block commit.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import type { Chunk } from "./types-2";

export type ToolCheckCmd = {
    name: string;                 // e.g. "typecheck"
    cmd: string;                  // e.g. "pnpm"
    args?: string[];              // e.g. ["-s", "tsc", "-p", "tsconfig.json", "--noEmit"]
    cwd?: string;                 // defaults to workspace_dir
    timeout_ms?: number;          // defaults to 120_000
    env?: Record<string, string>; // optional extra env
};

export type ToolCheckResult =
    | { ok: true; seals: []; reports: Array<{ name: string; exit_code: number; stdout: string; stderr: string }> }
    | { ok: false; seals: [Chunk]; reports: Array<{ name: string; exit_code: number; stdout: string; stderr: string }> };

function makeId(prefix: string) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function makeSeal(title: string, body: string): Chunk {
    return { id: makeId("seal"), kind: "TEXT", title, body };
}

async function runOne(cmd: ToolCheckCmd, workspace_dir: string) {
    const cwd = cmd.cwd ?? workspace_dir;
    const args = cmd.args ?? [];
    const timeout_ms = cmd.timeout_ms ?? 120_000;

    return new Promise<{ exit_code: number; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(cmd.cmd, args, {
            cwd,
            env: { ...process.env, ...(cmd.env ?? {}) },
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32", // makes pnpm/npm/yarn resolution easier on Windows
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));

        const timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            } catch {}
            resolve({ exit_code: 124, stdout, stderr: stderr + `\n[timeout after ${timeout_ms}ms]` });
        }, timeout_ms);

        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ exit_code: typeof code === "number" ? code : 1, stdout, stderr });
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            resolve({ exit_code: 1, stdout, stderr: stderr + `\n[spawn error] ${String(err)}` });
        });
    });
}

/**
 * TOOL-CHECK:
 * - run configured commands (typecheck/lint/test/build)
 * - fail-fast on first non-zero exit code (or run all; configurable below)
 */
export async function toolCheck(args: {
    workspace_dir: string;
    commands: ToolCheckCmd[];
    fail_fast?: boolean; // default true
}): Promise<ToolCheckResult> {
    const { workspace_dir, commands, fail_fast = true } = args;

    if (!workspace_dir || !commands?.length) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "TOOL_CHECK_FAIL",
                    "Tool-check skipped: missing workspace or commands. Provide a workspace directory and at least one command (typecheck/lint/test) to validate the commit."
                ),
            ],
            reports: [],
        };
    }

    const reports: Array<{ name: string; exit_code: number; stdout: string; stderr: string }> = [];

    for (const c of commands) {
        const r = await runOne(c, workspace_dir);
        reports.push({ name: c.name, ...r });

        if (r.exit_code !== 0 && fail_fast) {
            return {
                ok: false,
                seals: [
                    makeSeal(
                        "TOOL_CHECK_FAIL",
                        `Tool-check failed on "${c.name}" (exit ${r.exit_code}). Fix the errors, then retry commit.`
                    ),
                ],
                reports,
            };
        }
    }

    const firstFail = reports.find((r) => r.exit_code !== 0);
    if (firstFail) {
        return {
            ok: false,
            seals: [
                makeSeal(
                    "TOOL_CHECK_FAIL",
                    `Tool-check failed on "${firstFail.name}" (exit ${firstFail.exit_code}). Fix the errors, then retry commit.`
                ),
            ],
            reports,
        };
    }

    return { ok: true, seals: [], reports };
}
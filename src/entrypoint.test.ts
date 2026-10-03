import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let directory: string;
let installedBin: string;
const directBin = resolve("dist/index.js");

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hera installed # "));
  installedBin = join(directory, "hera");
  await symlink(directBin, installedBin);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function run(bin: string, args: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, HERA_HOME: directory },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("compiled CLI entry point", () => {
  it.each(["direct", "installed"])("prints help with no arguments through the %s entry point", async (mode) => {
    const result = await run(mode === "installed" ? installedBin : directBin);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: hera");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("schedule");
    expect(await readdir(directory)).toEqual(["hera"]);
  });

  it("dispatches help, subcommands, and invalid arguments through the installed symlink", async () => {
    const help = await run(installedBin, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: hera");
    const list = await run(installedBin, ["list", "plugins"]);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("No Hera-managed plugins.");
    const invalid = await run(installedBin, ["--not-a-hera-option"]);
    expect(invalid.code).not.toBe(0);
    expect(invalid.stderr).toContain("unknown option");
    expect(await readdir(directory)).toEqual(["hera"]);
  });
});

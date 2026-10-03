import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexProvider } from "./codex.js";

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("Codex execution outside Git repositories", () => {
  it.each([0, 17])("passes the repository-check override and propagates exit %i without retrying", async (exitCode) => {
    directory = await mkdtemp(join(tmpdir(), "hera-non-git-"));
    const executable = join(directory, "fake-codex");
    await writeFile(executable, `#!${process.execPath}\n
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { prompt += chunk; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  if (!args.includes("--skip-git-repo-check")) {
    process.stderr.write("Not inside a trusted directory");
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ args, cwd: process.cwd(), prompt }));
  process.exitCode = ${exitCode};
});
`, { mode: 0o700 });
    vi.stubEnv("CODEX_BIN", executable);
    const output: string[] = [];
    const result = await new CodexProvider().run({
      model: "gpt-6.1-so", prompt: "hi\n$(literal prompt)", cwd: directory, sessionName: "once"
    }, async (stream, text) => {
      expect(stream).toBe("stdout");
      output.push(text);
    });
    expect(result.exitCode).toBe(exitCode);
    const lines = output.join("").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      args: ["exec", "--json", "--skip-git-repo-check", "--model", "gpt-6.1-so", "-"],
      cwd: directory, prompt: "hi\n$(literal prompt)"
    });
  });
});

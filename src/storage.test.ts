import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logPath, readPlugins, readSchedules, saveSchedule } from "./storage.js";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { utimes } from "node:fs/promises";

let dir = "";
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); delete process.env.HERA_HOME; });
async function setup() { dir = await mkdtemp(join(tmpdir(), "hera-test-")); process.env.HERA_HOME = dir; }

describe("local state", () => {
  it("treats missing registries as empty and writes schedules using the versioned format", async () => {
    await setup();
    expect(await readSchedules()).toEqual([]); expect(await readPlugins()).toEqual([]);
    const schedule = { name: "daily", provider: "codex", model: "gpt-6.1", prompt: "hello", cron: "0 9 * * *", cwd: dir, timeZone: "UTC", createdAt: new Date().toISOString() };
    await saveSchedule(schedule);
    expect(JSON.parse(await readFile(join(dir, ".hera", "schedule.json"), "utf8"))).toEqual({ version: 1, schedules: [schedule] });
  });
  it("preserves corrupt registries and rejects path traversal names", async () => {
    await setup();
    const file = join(dir, ".hera", "schedule.json"); await mkdir(join(dir, ".hera")); await writeFile(file, "{broken");
    await expect(readSchedules()).rejects.toThrow(/Cannot read/);
    expect(await readFile(file, "utf8")).toBe("{broken");
    expect(() => logPath("codex", "../escape")).toThrow(/Unsafe/);
  });
  it("rejects conflicting schedule names while accepting identical retries", async () => {
    await setup();
    const schedule = { name: "daily", provider: "codex", model: "m", prompt: "p", cron: "0 9 * * *", cwd: dir, timeZone: "UTC", createdAt: new Date().toISOString() };
    await saveSchedule(schedule); await saveSchedule({ ...schedule, createdAt: new Date().toISOString() });
    await expect(saveSchedule({ ...schedule, prompt: "different" })).rejects.toThrow(/already exists/);
    expect(await readSchedules()).toHaveLength(1);
  });
  it("preserves concurrent updates from separate Hera processes", async () => {
    await setup();
    const moduleUrl = pathToFileURL(join(process.cwd(), "dist", "storage.js")).href;
    const save = (name: string) => new Promise<void>((resolvePromise, reject) => {
      const item = { name, provider: "codex", model: "m", prompt: name, cron: "0 9 * * *", cwd: dir, timeZone: "UTC", createdAt: new Date().toISOString() };
      const code = `const s=await import(${JSON.stringify(moduleUrl)}); await s.saveSchedule(JSON.parse(process.env.RECORD));`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, HERA_HOME: dir, RECORD: JSON.stringify(item) }, stdio: "ignore" });
      child.once("error", reject); child.once("close", (status) => status === 0 ? resolvePromise() : reject(new Error(`child exited ${status}`)));
    });
    await Promise.all([save("first"), save("second")]);
    expect((await readSchedules()).map((item) => item.name).sort()).toEqual(["first", "second"]);
  });
  it("recovers a stale state lock", async () => {
    await setup();
    const lock = join(dir, ".hera", "schedule.json.lock"); await mkdir(join(dir, ".hera")); await writeFile(lock, "stale");
    const old = new Date(Date.now() - 120_000); await utimes(lock, old, old);
    await saveSchedule({ name: "after-stale", provider: "codex", model: "m", prompt: "p", cron: "0 9 * * *", cwd: dir, timeZone: "UTC", createdAt: new Date().toISOString() });
    expect(await readSchedules()).toHaveLength(1);
  });
});

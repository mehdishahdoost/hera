import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { program } from "./cli.js";
import { execute } from "./runner.js";
import { readSchedules, removeSchedule, saveSchedule } from "./storage.js";
import { claimOccurrence, runScheduler } from "./scheduler.js";
import { appendPlugin } from "./storage.js";
import { createSessionName } from "./session-name.js";
import type { Provider } from "./types.js";
import { vi } from "vitest";

let home = "";
afterEach(async () => { if (home) await rm(home, { recursive: true, force: true }); delete process.env.HERA_HOME; });
const freshHome = async () => { home = await mkdtemp(join(tmpdir(), "hera-unit-")); process.env.HERA_HOME = home; return home; };

describe("public command tree", () => {
  it("exposes the seven requested command forms", () => {
    expect(program.commands.map((command) => command.name())).toEqual(expect.arrayContaining(["run", "schedule", "list", "plugin"]));
    const schedule = program.commands.find((command) => command.name() === "schedule")!;
    expect(schedule.commands.map((command) => command.name())).toContain("remove");
    expect(program.commands.find((command) => command.name() === "list")!.commands.map((command) => command.name())).toEqual(expect.arrayContaining(["schedule", "plugins", "models"]));
    expect(program.commands.find((command) => command.name() === "plugin")!.commands.map((command) => command.name())).toContain("install");
    for (const command of ["run", "schedule"]) {
      const item = program.commands.find((entry) => entry.name() === command)!;
      expect(item.options.map((option) => option.long)).toEqual(expect.arrayContaining(["--provider", "--model", "--prompt"]));
    }
  });

  it("lists and removes saved schedules without starting the scheduler", async () => {
    await freshHome();
    const item = { name: "daily", provider: "codex", model: "m", prompt: "p", cron: "0 9 * * *", cwd: home, timeZone: "UTC", createdAt: new Date().toISOString() };
    await saveSchedule(item);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "hera", "list", "schedule"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("daily\tcodex\tm\t0 9 * * *\tUTC"));
    await program.parseAsync(["node", "hera", "schedule", "remove", "daily"]);
    expect(await readSchedules()).toEqual([]);
    log.mockRestore();
  });

  it("lists saved plugins by provider and generates unique safe run names", async () => {
    await freshHome();
    await appendPlugin({ provider: "codex", name: "skill", sourcePath: "/tmp/skill", installedAt: new Date().toISOString(), providerId: "skill@local" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "hera", "list", "plugins"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skill\tcodex\t/tmp/skill"));
    log.mockRestore();
    const first = createSessionName(new Date("2026-01-02T03:04:05.000Z"));
    const second = createSessionName(new Date("2026-01-02T03:04:05.000Z"));
    expect(first).toMatch(/^run-20260102030405000-[a-f0-9]{6}$/);
    expect(second).not.toBe(first);
  });
});

describe("shared runner", () => {
  it("streams and appends complete records for repeated session runs", async () => {
    await freshHome();
    const provider: Provider = {
      name: "fake", async run(_request, emit) { await emit("stdout", "hello\n"); await emit("stderr", "detail\n"); return { exitCode: 0 }; },
      async listModels() { return []; }, async installPlugin() { throw new Error("unsupported"); }
    };
    const request = { model: "m", prompt: "p", cwd: process.cwd(), sessionName: "daily", scheduled: true };
    await execute(provider, request); await execute(provider, request);
    const path = join(home, ".hera", "fake", "daily.log");
    const log = await readFile(path, "utf8");
    expect(log.match(/execution .* started/g)).toHaveLength(2);
    expect(log.match(/exit=0/g)).toHaveLength(2);
    expect(log).toContain("[stdout] hello"); expect(log).toContain("[stderr] detail");
  });
  it("does not start the provider when its log cannot be opened", async () => {
    await freshHome(); await writeFile(join(home, ".hera"), "block directory creation");
    let calls = 0;
    const provider: Provider = { name: "fake", async run() { calls++; return { exitCode: 0 }; }, async listModels() { return []; }, async installPlugin() { throw new Error("unsupported"); } };
    await expect(execute(provider, { model: "m", prompt: "p", cwd: home, sessionName: "once" })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("returns the provider failure once without retrying", async () => {
    await freshHome(); let calls = 0;
    const provider: Provider = { name: "fake", async run() { calls++; return { exitCode: 17 }; }, async listModels() { return []; }, async installPlugin() { throw new Error("unsupported"); } };
    const result = await execute(provider, { model: "m", prompt: "p", cwd: home, sessionName: "failed" });
    expect(result.exitCode).toBe(17); expect(calls).toBe(1);
    expect(await readFile(join(home, ".hera", "fake", "failed.log"), "utf8")).toContain("exit=17");
  });
});

describe("scheduler core", () => {
  it("claims each schedule occurrence once across scheduler restarts", async () => {
    await freshHome();
    expect(await claimOccurrence("daily", 123456)).toBe(true);
    expect(await claimOccurrence("daily", 123456)).toBe(false);
    expect(await claimOccurrence("daily", 123457)).toBe(true);
  });
  it("observes registrations, then exits after the final schedule is removed", async () => {
    await freshHome();
    await saveSchedule({ name: "annual", provider: "codex", model: "m", prompt: "p", cron: "0 0 1 1 *", cwd: home, timeZone: "UTC", createdAt: new Date().toISOString() });
    const scheduler = runScheduler();
    const leasePath = join(home, ".hera", "runtime", "scheduler.json");
    for (let index = 0; index < 30; index++) {
      try { if (JSON.parse(await readFile(leasePath, "utf8")).ready) break; } catch { /* scheduler starting */ }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    expect(await readSchedules()).toHaveLength(1);
    await removeSchedule("annual");
    await scheduler;
    await expect(readFile(leasePath, "utf8")).rejects.toThrow();
  }, 8_000);
});

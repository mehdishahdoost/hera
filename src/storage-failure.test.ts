import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => {
    if (process.env.HERA_TEST_FAIL_RENAME === "1") throw new Error("injected rename failure");
    return actual.rename(...args);
  } };
});
const { saveSchedule } = await import("./storage.js");
const { readSchedules } = await import("./storage.js");
let dir = "";
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); delete process.env.HERA_HOME; delete process.env.HERA_TEST_FAIL_RENAME; });

describe("atomic state replacement", () => {
  it("keeps the last complete registry when atomic replacement fails", async () => {
    dir = await mkdtemp(join(tmpdir(), "hera-failure-test-")); process.env.HERA_HOME = dir;
    const first = { name: "stable", provider: "codex", model: "m", prompt: "p", cron: "0 9 * * *", cwd: dir, timeZone: "UTC", createdAt: new Date().toISOString() };
    await saveSchedule(first);
    const file = join(dir, ".hera", "schedule.json"); const before = await readFile(file, "utf8");
    process.env.HERA_TEST_FAIL_RENAME = "1";
    await expect(saveSchedule({ ...first, name: "second" })).rejects.toThrow(/injected rename failure/);
    expect(await readFile(file, "utf8")).toBe(before);
    delete process.env.HERA_TEST_FAIL_RENAME;
    expect(await readSchedules()).toEqual([first]);
  });
});

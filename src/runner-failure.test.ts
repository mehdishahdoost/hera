import { afterEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "./types.js";

let appendCalls = 0; let closed = false;
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async () => undefined,
    open: async () => ({
      appendFile: async () => { appendCalls++; if (appendCalls === 2) throw new Error("disk full"); },
      close: async () => { closed = true; }
    })
  };
});
const { execute } = await import("./runner.js");
afterEach(() => { appendCalls = 0; closed = false; });

describe("runner log failures", () => {
  it("stops the run and closes the log when streaming output cannot be saved", async () => {
    let calls = 0;
    const provider: Provider = {
      name: "fake", async run(_request, emit) { calls++; await emit("stdout", "chunk"); return { exitCode: 0 }; },
      async listModels() { return []; }, async installPlugin() { throw new Error("unsupported"); }
    };
    await expect(execute(provider, { model: "m", prompt: "p", cwd: ".", sessionName: "failure" })).rejects.toThrow();
    expect(calls).toBe(1); expect(closed).toBe(true);
  });
});

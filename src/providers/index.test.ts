import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./index.js";
import type { Provider } from "../types.js";

const fakeProvider = (name: string): Provider => ({
  name,
  async run() { return { exitCode: 0 }; },
  async listModels() { return [{ id: "fake-model", name: "Fake Model" }]; },
  async installPlugin() { throw new Error("not supported"); }
});

describe("provider registry", () => {
  it("routes shared capabilities to a separately registered provider", async () => {
    const registry = new ProviderRegistry(); registry.register(fakeProvider("fake"));
    await expect(registry.get("fake").listModels()).resolves.toEqual([{ id: "fake-model", name: "Fake Model" }]);
  });
  it("does not fall back for unknown providers", () => {
    const registry = new ProviderRegistry(); registry.register(fakeProvider("codex"));
    expect(() => registry.get("claude")).toThrow(/Unsupported provider 'claude'/);
  });
});

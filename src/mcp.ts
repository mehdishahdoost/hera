import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { parseDefinition, saveMcpDefinition, type McpDefinition } from "./mcp-definition.js";
import { detectPlatforms, loadPlatforms, registerPlatform, type AvailablePlatform, type Platform } from "./mcp-platforms.js";
import { statePath } from "./storage.js";

export class SelectionCancelled extends Error { constructor() { super("Platform selection cancelled; MCP definition remains saved."); } }

export function selectPlatforms(platforms: AvailablePlatform[], input: Readable = process.stdin, output: Writable = process.stdout): Promise<AvailablePlatform[]> {
  return new Promise((resolvePromise, reject) => {
    const rl = createInterface({ input, output, terminal: false });
    let settled = false;
    const cleanup = () => { process.off("SIGINT", interrupt); };
    const finish = (selected: AvailablePlatform[]) => { settled = true; cleanup(); rl.close(); resolvePromise(selected); };
    const interrupt = () => { settled = true; cleanup(); rl.close(); reject(new SelectionCancelled()); };
    process.once("SIGINT", interrupt);
    const onData = (chunk: Buffer | string) => { if (chunk.toString().includes("\u0003")) interrupt(); };
    input.on("data", onData);
    rl.on("SIGINT", interrupt);
    rl.on("close", () => { input.off("data", onData); cleanup(); if (!settled) resolvePromise([]); });
    rl.on("error", () => { if (!settled) interrupt(); });
    const prompt = () => output.write("Select platforms (comma-separated numbers or ids; Enter or 'skip' to skip): ");
    platforms.forEach((platform, index) => output.write(`${index + 1}. ${platform.name} (${platform.id})\n`));
    rl.on("line", (line) => {
      if (line.includes("\u0003")) { interrupt(); return; }
      if (!line.trim() || line.trim().toLowerCase() === "skip") { finish([]); return; }
      const selected: AvailablePlatform[] = [];
      for (const token of line.split(",").map((part) => part.trim())) {
        const platform = platforms.find((item, index) => item.id === token || String(index + 1) === token);
        if (!platform) { output.write("Invalid selection; choose only listed platforms.\n"); prompt(); return; }
        if (!selected.includes(platform)) selected.push(platform);
      }
      finish(selected);
    });
    prompt();
  });
}

export interface McpServices {
  save: typeof saveMcpDefinition;
  load: () => Promise<Platform[]>;
  detect: typeof detectPlatforms;
  select: (platforms: AvailablePlatform[]) => Promise<AvailablePlatform[]>;
  register: (platform: AvailablePlatform, name: string, definition: McpDefinition) => Promise<void>;
  interactive: boolean;
  log: (message: string) => void;
}
export async function addMcp(name: string, command: string[], env: string[], overrides: Partial<McpServices> = {}): Promise<number> {
  const services: McpServices = {
    save: saveMcpDefinition, load: loadPlatforms, detect: detectPlatforms, select: selectPlatforms,
    register: registerPlatform, interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
    log: console.log, ...overrides
  };
  const definition = parseDefinition(name, command, env);
  await services.save(name, definition);
  services.log(`Saved '${name}' to ${statePath("mcp.config")}.`);
  try {
    const detected = await services.detect(await services.load());
    const available: AvailablePlatform[] = [];
    for (const platform of detected) {
      if (platform.bin) available.push({ ...platform, bin: platform.bin });
      else services.log(`${platform.name}: unavailable (not installed or executable not found).`);
    }
    if (!available.length) { services.log("No supported platforms installed; definition remains saved."); return 0; }
    if (!services.interactive) { services.log("Noninteractive input/output: platform registration skipped. Run the same command in a terminal to register."); return 0; }
    const selected = await services.select(available);
    if (!selected.length) { services.log("Platform registration skipped; definition remains saved."); return 0; }
    let failures = 0;
    for (const platform of selected) {
      try { await services.register(platform, name, definition); services.log(`${platform.name}: registered '${name}'.`); }
      catch (error) {
        failures++;
        let message = error instanceof Error ? error.message : "Registration failed.";
        for (const value of Object.values(definition.env).filter(Boolean).sort((a, b) => b.length - a.length)) message = message.split(value).join("[redacted]");
        services.log(`${platform.name}: ${message}`);
      }
    }
    if (failures) services.log("Some registrations failed; definition remains saved. Repeat the identical command to retry.");
    return failures ? 1 : 0;
  } catch (error) {
    if (error instanceof SelectionCancelled) throw error;
    // Do not pass arbitrary catalog/detection errors through secret-bearing output.
    throw new Error("Platform setup failed; MCP definition remains saved. Check bundled catalog and platform executables.");
  }
}

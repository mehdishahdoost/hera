import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { definitionSchema, identicalDefinition, type McpDefinition } from "./mcp-definition.js";

const platformSchema = z.object({ id: z.enum(["codex", "claude"]), name: z.string().min(1), executable: z.string().min(1) }).strict();
const catalogSchema = z.object({ version: z.literal(1), platforms: z.array(platformSchema).min(1) }).strict()
  .refine((catalog) => new Set(catalog.platforms.map((item) => item.id)).size === catalog.platforms.length);
export type Platform = z.infer<typeof platformSchema>;
export type AvailablePlatform = Platform & { bin: string };

export async function loadPlatforms(path: URL | string = new URL("../platform.json", import.meta.url)): Promise<Platform[]> {
  try { return catalogSchema.parse(JSON.parse(await readFile(path, "utf8"))).platforms; }
  catch { throw new Error("Cannot load bundled platform.json: missing or invalid supported-platform catalog."); }
}

export async function findExecutable(command: string, env = process.env, os = process.platform): Promise<string | undefined> {
  const extensions = os === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  const bases = isAbsolute(command) || command.includes("/") || command.includes("\\")
    ? [resolve(command)] : (env.PATH || "").split(delimiter).filter(Boolean).map((dir) => resolve(dir, command));
  for (const base of bases) {
    const candidates = os === "win32" ? [base, ...extensions.map((ext) => base + ext.toLowerCase()), ...extensions.map((ext) => base + ext)] : [base];
    for (const candidate of candidates) {
      try { await access(candidate, os === "win32" ? constants.F_OK : constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; }
      catch { /* continue searching */ }
    }
  }
  return undefined;
}

export async function detectPlatforms(platforms: Platform[]): Promise<Array<Platform & { bin?: string }>> {
  return Promise.all(platforms.map(async (item) => {
    const override = item.id === "codex" ? process.env.CODEX_BIN : process.env.CLAUDE_BIN;
    const bin = await findExecutable(override || item.executable);
    return bin ? { ...item, bin } : item;
  }));
}

// Never include native output or argv in diagnostics: both may contain credentials.
export function nativeCommand(bin: string, args: string[], timeoutMs = 15_000, maxBytes = 1_048_576): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let bytes = 0; let failure: Error | undefined;
    const stop = (message: string) => { failure ??= new Error(message); child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop("Platform CLI timed out."), timeoutMs);
    child.stdout.on("data", (data: Buffer) => { bytes += data.length; if (bytes > maxBytes) stop("Platform CLI output exceeded limit."); else output += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { bytes += data.length; if (bytes > maxBytes) stop("Platform CLI output exceeded limit."); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("Platform CLI could not be started; check executable installation and compatibility.")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Platform CLI failed (exit ${code ?? "unknown"}); check configuration and CLI compatibility.`));
      else resolvePromise(output);
    });
  });
}

function normalizeDefinition(raw: unknown): McpDefinition | undefined {
  if (typeof raw !== "object" || raw === null) throw new Error("Unsupported platform MCP configuration format.");
  const value = raw as Record<string, unknown>;
  if (value.type && value.type !== "stdio") return undefined;
  const result = definitionSchema.safeParse({ command: value.command, args: value.args ?? [], env: value.env ?? {} });
  if (!result.success) throw new Error("Unsupported platform MCP configuration format.");
  // Settings affecting launch semantics cannot count as an identical definition.
  if (value.cwd || (Array.isArray(value.env_vars) && value.env_vars.length)) return undefined;
  return result.data;
}

export async function inspectPlatform(platform: AvailablePlatform, name: string): Promise<{ exists: boolean; definition?: McpDefinition }> {
  let raw: unknown;
  if (platform.id === "codex") {
    let list: unknown;
    try { list = JSON.parse(await nativeCommand(platform.bin, ["mcp", "list", "--json"])); }
    catch { throw new Error("Cannot inspect Codex MCP configuration; check CLI compatibility and configuration."); }
    if (!Array.isArray(list) || list.some((item) => !item || typeof item.name !== "string")) throw new Error("Unsupported Codex MCP readback format.");
    const item = list.find((item) => item.name === name);
    if (!item) return { exists: false };
    raw = item.transport;
  } else {
    // `claude mcp get/list` performs health checks. Read only the user-scope JSON.
    const path = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(homedir(), ".claude.json");
    let config: unknown;
    try { config = JSON.parse(await readFile(path, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
      throw new Error("Cannot read Claude Code user configuration; original file preserved.");
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Unsupported Claude Code user configuration format.");
    const servers = (config as Record<string, unknown>).mcpServers;
    if (servers === undefined) return { exists: false };
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw new Error("Unsupported Claude Code MCP configuration format.");
    if (!Object.hasOwn(servers, name)) return { exists: false };
    raw = (servers as Record<string, unknown>)[name];
  }
  const definition = normalizeDefinition(raw);
  return definition ? { exists: true, definition } : { exists: true };
}

export async function registerPlatform(platform: AvailablePlatform, name: string, definition: McpDefinition): Promise<void> {
  const existing = await inspectPlatform(platform, name);
  if (existing.exists) {
    if (existing.definition && identicalDefinition(existing.definition, definition)) return;
    throw new Error("A different user-scope MCP server already uses this name; existing configuration preserved.");
  }
  const envArgs = Object.entries(definition.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  const args = platform.id === "codex"
    ? ["mcp", "add", name, ...envArgs, "--", definition.command, ...definition.args]
    : ["mcp", "add", "--scope", "user", "--transport", "stdio", name, ...envArgs, "--", definition.command, ...definition.args];
  let failure: unknown;
  try { await nativeCommand(platform.bin, args); } catch (error) { failure = error; }
  const result = await inspectPlatform(platform, name);
  if (result.definition && identicalDefinition(result.definition, definition)) return;
  if (failure) throw failure;
  throw new Error("Platform registration could not be confirmed by readback.");
}

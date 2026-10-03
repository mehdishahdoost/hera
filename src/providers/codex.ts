import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelInfo, PluginInfo, PluginInstallRequest, Provider, ProviderResult, RunRequest } from "../types.js";
import { stateRoot } from "../storage.js";

function runCommand(command: string, args: string[], cwd?: string, input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
    if (input === undefined) child.stdin.end(); else child.stdin.end(input);
  });
}

export class CodexProvider implements Provider {
  readonly name = "codex";
  async run(request: RunRequest, emit: (stream: "stdout" | "stderr", text: string) => Promise<void>, onChildSpawn?: (pid: number) => Promise<void>): Promise<ProviderResult> {
    return await new Promise<ProviderResult>((resolvePromise, reject) => {
      const child = spawn(process.env.CODEX_BIN || "codex", ["exec", "--json", "--skip-git-repo-check", "--model", request.model, "-"], { cwd: request.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      let failed: unknown;
      child.stdout.on("data", (chunk: Buffer) => { void emit("stdout", chunk.toString()).catch((error) => { failed = error; child.kill("SIGTERM"); }); });
      child.stderr.on("data", (chunk: Buffer) => { void emit("stderr", chunk.toString()).catch((error) => { failed = error; child.kill("SIGTERM"); }); });
      child.once("error", reject);
      child.once("spawn", () => { if (child.pid && onChildSpawn) void onChildSpawn(child.pid).catch((error) => { failed = error; child.kill("SIGTERM"); }); });
      child.once("close", (code, signal) => failed ? reject(failed) : resolvePromise({ exitCode: code ?? (signal ? 1 : 0) }));
      const onInt = () => child.kill("SIGINT"); const onTerm = () => child.kill("SIGTERM");
      process.once("SIGINT", onInt); process.once("SIGTERM", onTerm);
      child.once("close", () => { process.off("SIGINT", onInt); process.off("SIGTERM", onTerm); });
      child.stdin.end(request.prompt);
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    const child = spawn(process.env.CODEX_BIN || "codex", ["app-server", "--listen", "stdio://"], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const timeout = setTimeout(() => {
      const error = new Error("Codex app-server model discovery timed out.");
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear(); child.kill("SIGTERM");
      const forceStop = setTimeout(() => child.kill("SIGKILL"), 1_000); forceStop.unref();
    }, 15_000);
    let buffer = ""; let id = 0; let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString(); let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
          if (message.id !== undefined) {
            const waiter = pending.get(message.id); if (!waiter) continue;
            pending.delete(message.id);
            if (message.error) waiter.reject(new Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
          }
        }
        catch { /* Ignore non-JSON startup chatter; requests still time out if protocol is unavailable. */ }
      }
    });
    const rejectPending = (error: Error) => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); };
    child.once("error", (error) => rejectPending(error));
    child.once("close", (code, signal) => { if (pending.size) rejectPending(new Error(`Codex app-server closed before replying (exit ${code ?? signal ?? "unknown"}).`)); });
    const request = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolvePromise, reject) => {
      const current = ++id; pending.set(current, { resolve: resolvePromise, reject });
      child.stdin.write(`${JSON.stringify({ method, id: current, params })}\n`, (error) => { if (error) { pending.delete(current); reject(error); } });
    });
    try {
      await request("initialize", { clientInfo: { name: "hera", title: "Hera", version: "0.1.0" } });
      child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
      let cursor: unknown; const models: ModelInfo[] = [];
      do {
        const result = await request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }) as { data?: Array<{ id?: string; model?: string; displayName?: string }>; nextCursor?: unknown };
        for (const item of result.data ?? []) { const id = item.id ?? item.model; if (id) models.push({ id, name: item.displayName ?? id }); }
        cursor = result.nextCursor;
      } while (cursor);
      return models;
    } catch (error) { throw new Error(`Codex model discovery failed${stderr ? `: ${stderr.trim()}` : ""}: ${String(error)}`); }
    finally { clearTimeout(timeout); child.kill("SIGTERM"); }
  }

  async installPlugin(request: PluginInstallRequest): Promise<PluginInfo> {
    const sourcePath = await realpath(request.path);
    const candidates = ["plugin.json", ".codex-plugin/plugin.json"];
    let manifest: { name?: string; version?: string } | undefined;
    for (const candidate of candidates) {
      try { manifest = JSON.parse(await readFile(join(sourcePath, candidate), "utf8")) as typeof manifest; break; } catch { /* check the next supported manifest */ }
    }
    if (!manifest?.name || !/^[\w.-]+$/.test(manifest.name)) throw new Error("Plugin path must contain a supported plugin manifest with a valid name.");
    const marketplaceName = `hera-${manifest.name}-${randomUUID().slice(0, 8)}`;
    const root = join(stateRoot(), "providers", "codex", "marketplaces", marketplaceName);
    const pluginRoot = join(root, "plugins", manifest.name);
    await mkdir(dirname(pluginRoot), { recursive: true, mode: 0o700 });
    const { cp } = await import("node:fs/promises");
    await cp(sourcePath, pluginRoot, { recursive: true, errorOnExist: true });
    const marketplace = { name: marketplaceName, plugins: [{ name: manifest.name, source: { source: "local", path: `./plugins/${manifest.name}` }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }] };
    const marketplaceFile = join(root, ".agents", "plugins", "marketplace.json");
    await mkdir(dirname(marketplaceFile), { recursive: true, mode: 0o700 });
    await writeFile(marketplaceFile, `${JSON.stringify(marketplace, null, 2)}\n`, { mode: 0o600 });
    const added = await runCommand(process.env.CODEX_BIN || "codex", ["plugin", "marketplace", "add", root]);
    if (added.code) throw new Error(`Codex could not add the plugin marketplace: ${added.stderr.trim()}`);
    const installed = await runCommand(process.env.CODEX_BIN || "codex", ["plugin", "add", manifest.name, "--marketplace", marketplaceName, "--json"]);
    if (installed.code) throw new Error(`Codex could not install plugin '${manifest.name}': ${installed.stderr.trim()}`);
    return { provider: this.name, name: manifest.name, ...(manifest.version ? { version: manifest.version } : {}), sourcePath, installedAt: new Date().toISOString(), providerId: `${manifest.name}@${marketplaceName}` };
  }
}

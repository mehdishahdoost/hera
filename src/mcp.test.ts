import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { addMcp, selectPlatforms, SelectionCancelled } from "./mcp.js";
import { parseDefinition, readMcpDefinitions, saveMcpDefinition } from "./mcp-definition.js";
import { detectPlatforms, findExecutable, loadPlatforms, nativeCommand, registerPlatform, type AvailablePlatform } from "./mcp-platforms.js";

const roots: string[] = [];
const originalEnv = { ...process.env };
afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function home() { const root = await mkdtemp(join(tmpdir(), "hera-mcp-test-")); roots.push(root); process.env.HERA_HOME = root; return root; }
const entry = resolve("dist/index.js");
function cli(args: string[], env = process.env, cwd = process.cwd()) {
  return new Promise<{ code: number | null; output: string }>((done, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", (chunk) => output += chunk); child.stderr.on("data", (chunk) => output += chunk);
    child.once("error", reject); child.once("close", (code) => done({ code, output }));
  });
}
const definition = () => parseDefinition("demo", ["hera-never-launch", "space arg", "$(touch nope)", "--flag"], ["TOKEN=a=b", "EMPTY="]);

describe("MCP command and storage", () => {
  it("preserves argv, env values and last assignment without launching the command", async () => {
    const root = await home();
    const result = await cli(["mcp", "add", "demo", "--env", "TOKEN=a=b", "--env", "REGION=eu", "--env", "REGION=us", "--env", "EMPTY=", "--", "hera-never-launch", "space arg", "$(touch nope)", "--flag"]);
    expect(result.code).toBe(0); expect(result.output).not.toContain("a=b");
    expect((await readMcpDefinitions()).servers.demo).toEqual({ ...definition(), env: { TOKEN: "a=b", REGION: "us", EMPTY: "" } });
    expect((await stat(join(root, ".hera", "mcp.config"))).mode & 0o777).toBe(0o600);
  });
  it("handles shell line continuations as a single command", async () => {
    await home();
    const result = await new Promise<number | null>((done) => {
      const child = spawn("bash", ["-c", '"$NODE_BIN" "$HERA_ENTRY" mcp add demo \\\n --env TOKEN=a=b \\\n -- npx -y package --port 3000'], { env: { ...process.env, NODE_BIN: process.execPath, HERA_ENTRY: entry }, stdio: "ignore" });
      child.once("close", done);
    });
    expect(result).toBe(0); expect((await readMcpDefinitions()).servers.demo?.args).toEqual(["-y", "package", "--port", "3000"]);
  });
  it.each([
    ["mcp", "add", "demo", "npx"], ["mcp", "add", "demo", "--"],
    ["mcp", "add", "../bad", "--", "npx"], ["mcp", "add", "", "--", "npx"],
    ["mcp", "add", "demo", "--env", "BAD", "--", "npx"],
    ["mcp", "add", "demo", "--env", "1BAD=x", "--", "npx"],
    ["mcp", "add", "demo", "npx", "--", "arg"]
  ])("rejects invalid input without saving: %j", async (...args) => {
    const root = await home(); expect((await cli(args)).code).not.toBe(0);
    await expect(readFile(join(root, ".hera", "mcp.config"))).rejects.toThrow();
  });
  it("keeps unrelated definitions and accepts env ordering on retry", async () => {
    await home(); await saveMcpDefinition("demo", definition());
    await saveMcpDefinition("other", parseDefinition("other", ["npx"], []));
    await saveMcpDefinition("demo", { ...definition(), env: { EMPTY: "", TOKEN: "a=b" } });
    await expect(saveMcpDefinition("demo", { ...definition(), command: "different" })).rejects.toThrow("already exists");
    expect(Object.keys((await readMcpDefinitions()).servers)).toEqual(["demo", "other"]);
  });
  it("preserves concurrent processes and safe own dictionary keys", async () => {
    await home(); const results = await Promise.all(["a", "b", "constructor", "__proto__"].map((name) => cli(["mcp", "add", name, "--", "npx"])));
    expect(results.every((item) => item.code === 0)).toBe(true);
    expect(Object.keys((await readMcpDefinitions()).servers).sort()).toEqual(["__proto__", "a", "b", "constructor"]);
  });
  it.each(['{"version":2,"servers":{}}', '{"version":1,"servers":{"demo":{"command":123,"env":{"TOKEN":"private"}}}}', 'broken'])("preserves malformed state", async (raw) => {
    const root = await home(); await mkdir(join(root, ".hera")); const file = join(root, ".hera", "mcp.config"); await writeFile(file, raw);
    const result = await cli(["mcp", "add", "demo", "--", "npx"]);
    expect(result.code).toBe(1); expect(result.output).not.toContain("private"); expect(await readFile(file, "utf8")).toBe(raw);
  });
  it("stops before detection when persistence fails", async () => {
    const root = await home(); await writeFile(join(root, ".hera"), "block"); let called = false;
    await expect(addMcp("demo", ["npx"], [], { load: async () => { called = true; return []; } })).rejects.toThrow(); expect(called).toBe(false);
  });
});

describe("supported platforms", () => {
  it("loads catalog independently of cwd and rejects broken or duplicate entries", async () => {
    const root = await home(); expect((await loadPlatforms()).map((item) => item.id)).toEqual(["codex", "claude"]);
    const file = join(root, "catalog.json"); await writeFile(file, "broken"); await expect(loadPlatforms(file)).rejects.toThrow("platform.json");
    await expect(loadPlatforms(join(root, "missing"))).rejects.toThrow();
    const platforms = await loadPlatforms(); await writeFile(file, JSON.stringify({ version: 1, platforms: [platforms[0], platforms[0]] })); await expect(loadPlatforms(file)).rejects.toThrow();
  });
  it("separates catalog from availability and honors overrides", async () => {
    const root = await home(); process.env.PATH = root; delete process.env.CODEX_BIN; delete process.env.CLAUDE_BIN;
    const platforms = await loadPlatforms(); expect((await detectPlatforms(platforms)).every((item) => !item.bin)).toBe(true);
    const bin = join(root, "custom"); await writeFile(bin, "#!/bin/sh\nexit 0\n", { mode: 0o700 }); process.env.CODEX_BIN = bin;
    expect((await detectPlatforms(platforms)).map((item) => !!item.bin)).toEqual([true, false]); process.env.CLAUDE_BIN = bin;
    expect((await detectPlatforms(platforms)).every((item) => item.bin)).toBe(true);
    expect(await findExecutable("custom", { PATH: root })).toBe(bin);
    await writeFile(join(root, "windows.EXE"), "fixture"); expect(await findExecutable("windows", { PATH: root, PATHEXT: ".EXE" }, "win32")).toBe(join(root, "windows.EXE"));
    expect((await cli(["run", "--provider", "claude", "--model", "m", "--prompt", "p"])).output).toContain("Unsupported provider");
  });
});

const platforms: AvailablePlatform[] = [{ id: "codex", name: "Codex", executable: "codex", bin: "codex" }, { id: "claude", name: "Claude Code", executable: "claude", bin: "claude" }];
describe("selection and save-first orchestration", () => {
  async function select(text: string, eof = false) {
    const input = new PassThrough(); const output = new PassThrough(); let log = ""; output.on("data", (data) => log += data);
    const result = selectPlatforms(platforms, input, output); input.write(text); if (eof) input.end(); return { selected: await result, log, input };
  }
  it.each([["1,2\n", 2], ["claude\n", 1], ["1,1\n", 1], ["skip\n", 0], ["\n", 0], ["invalid\n2\n", 1]])("selects %s", async (text, count) => { expect((await select(text as string)).selected).toHaveLength(count as number); });
  it("handles EOF and Ctrl-C without selecting", async () => {
    expect((await select("", true)).selected).toEqual([]);
    const input = new PassThrough(); const output = new PassThrough(); const pending = selectPlatforms(platforms, input, output); input.write("\u0003"); await expect(pending).rejects.toBeInstanceOf(SelectionCancelled);
  });
  it("saves before loading/detection/selection, reports partial failures and redacts secrets", async () => {
    await home(); const events: string[] = []; const logs: string[] = [];
    const result = await addMcp("demo", ["npx"], ["TOKEN=private-secret"], {
      save: async (name, def) => { events.push("save"); await saveMcpDefinition(name, def); },
      load: async () => { events.push("load"); expect((await readMcpDefinitions()).servers.demo).toBeDefined(); return platforms; },
      detect: async () => { events.push("detect"); return platforms; }, select: async () => { events.push("select"); return platforms; },
      register: async (platform) => { events.push(platform.id); if (platform.id === "claude") throw new Error("echo private-secret"); }, interactive: true, log: (text) => logs.push(text)
    });
    expect(events).toEqual(["save", "load", "detect", "select", "codex", "claude"]); expect(result).toBe(1); expect(logs.join("\n")).not.toContain("private-secret"); expect(logs.join("\n")).toContain("remains saved");
  });
  it("skips redirected input, absent platforms and selection cancellation without mutation", async () => {
    await home(); let calls = 0;
    const services = { detect: async () => platforms, register: async () => { calls++; }, log: () => {} };
    expect(await addMcp("demo", ["npx"], [], { ...services, interactive: false })).toBe(0);
    expect(await addMcp("demo", ["npx"], [], { ...services, detect: async () => [], interactive: true })).toBe(0);
    await expect(addMcp("demo", ["npx"], [], { ...services, interactive: true, select: async () => { throw new SelectionCancelled(); } })).rejects.toThrow("remains saved"); expect(calls).toBe(0);
  });
});

describe("bounded native commands", () => {
  it("handles failure, missing executables, output limits and timeouts without echoing native output", async () => {
    await expect(nativeCommand(process.execPath, ["-e", "console.error('private');process.exit(3)"])).rejects.toThrow("exit 3");
    await expect(nativeCommand("/nonexistent/hera-cli", [])).rejects.toThrow("could not be started");
    await expect(nativeCommand(process.execPath, ["-e", "setTimeout(()=>{},10000)"], 50)).rejects.toThrow("timed out");
    await expect(nativeCommand(process.execPath, ["-e", "console.log('x'.repeat(1000))"], 1000, 100)).rejects.toThrow("limit");
  });
});

describe("native adapter fixtures and recovery", () => {
  async function fixture() {
    const root = await home(); process.env.CLAUDE_CONFIG_DIR = root;
    const file = join(root, "platform");
    await writeFile(file, `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const root = process.env.HERA_HOME;
const claude = args.includes('--scope');
const configFile = path.join(root, claude ? '.claude.json' : 'codex.json');
let config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile,'utf8')) : {mcpServers:{},retained:true};
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(args)+'\\n');
if(args[1]==='list'){process.stdout.write(JSON.stringify(Object.entries(config.mcpServers).map(([name,transport])=>({name,transport}))));process.exit(0);}
if(args[1]!=='add'){process.exit(2);}
if(process.env.FAIL_BEFORE){console.error('private-secret');process.exit(3);}
const name=claude ? args[6] : args[2]; const split=args.indexOf('--'); const env={};
for(let i=claude?7:3;i<split;i+=2){const j=args[i+1].indexOf('=');env[args[i+1].slice(0,j)]=args[i+1].slice(j+1);}
config.mcpServers[name]={type:'stdio',command:args[split+1],args:args.slice(split+2),env};
fs.writeFileSync(configFile,JSON.stringify(config));
if(process.env.FAIL_AFTER){console.error('private-secret');process.exit(4);}
`, { mode: 0o700 });
    return { root, bin: file };
  }
  it("reconciles a write followed by failure and preserves identical/conflicting records", async () => {
    const { root, bin } = await fixture(); const platform = { ...platforms[0]!, bin }; process.env.FAIL_AFTER = "1";
    await registerPlatform(platform, "demo", definition());
    await registerPlatform(platform, "demo", definition());
    await expect(registerPlatform(platform, "demo", { ...definition(), command: "different" })).rejects.toThrow("different");
    const calls = (await readFile(join(root, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.filter((args) => args[1] === "add")).toHaveLength(1);
    expect(calls.find((args) => args[1] === "add")).toEqual(["mcp", "add", "demo", "--env", "TOKEN=a=b", "--env", "EMPTY=", "--", ...[definition().command, ...definition().args]]);
    expect(JSON.parse(await readFile(join(root, "codex.json"), "utf8")).retained).toBe(true);
  });
  it("registers both, continues after missing executable and retries without repeating successes", async () => {
    const { root, bin } = await fixture(); const selected = platforms.map((platform) => ({ ...platform, bin })); const logs: string[] = [];
    const services = { detect: async () => selected, select: async () => selected, interactive: true, log: (line: string) => logs.push(line) };
    let disappear = true;
    const register = async (platform: AvailablePlatform, name: string, def: ReturnType<typeof definition>) => {
      await registerPlatform(disappear && platform.id === "claude" ? { ...platform, bin: join(root, "missing") } : platform, name, def);
    };
    expect(await addMcp("demo", [definition().command, ...definition().args], ["TOKEN=a=b", "EMPTY="], { ...services, register })).toBe(1);
    disappear = false;
    expect(await addMcp("demo", [definition().command, ...definition().args], ["TOKEN=a=b", "EMPTY="], { ...services, register })).toBe(0);
    const calls = (await readFile(join(root, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.filter((args) => args[1] === "add")).toHaveLength(2);
    expect(JSON.parse(await readFile(join(root, ".claude.json"), "utf8")).mcpServers.demo.env).toEqual(definition().env);
    expect(logs.join("\n")).not.toContain("a=b");
  });
  it("rejects incompatible readback and failed writes without exposing child diagnostics", async () => {
    const { root, bin } = await fixture(); process.env.FAIL_BEFORE = "1";
    await expect(registerPlatform({ ...platforms[0]!, bin }, "demo", definition())).rejects.toThrow("exit 3");
    await writeFile(join(root, "codex.json"), "invalid");
    await expect(registerPlatform({ ...platforms[0]!, bin }, "demo", definition())).rejects.toThrow("Cannot inspect");
  });
});

describe("isolated installed native adapters", () => {
  it("registers and reads both native user configurations without launching servers", async () => {
    const root = await home(); const codex = await findExecutable(originalEnv.CODEX_BIN || "codex", originalEnv); const claude = await findExecutable(originalEnv.CLAUDE_BIN || "claude", originalEnv);
    if (!codex || !claude) return; // Native compatibility smoke only when both CLIs are installed.
    process.env.CODEX_HOME = join(root, ".codex"); process.env.CLAUDE_CONFIG_DIR = join(root, ".claude");
    await mkdir(process.env.CODEX_HOME); await mkdir(process.env.CLAUDE_CONFIG_DIR);
    await writeFile(join(root, ".codex", "config.toml"), 'model = "retained"\n');
    await writeFile(join(root, ".claude", ".claude.json"), JSON.stringify({ custom: "retained", projects: { [root]: { mcpServers: { demo: { command: "local-other", args: [] } } } } }));
    for (const platform of [{ ...platforms[0]!, bin: codex }, { ...platforms[1]!, bin: claude }]) {
      await registerPlatform(platform, "demo", definition()); await registerPlatform(platform, "demo", definition());
      await expect(registerPlatform(platform, "demo", { ...definition(), command: "conflict" })).rejects.toThrow("different");
    }
    expect(await readFile(join(root, ".codex", "config.toml"), "utf8")).toContain('model = "retained"');
    const config = JSON.parse(await readFile(join(root, ".claude", ".claude.json"), "utf8")); expect(config.custom).toBe("retained"); expect(config.projects[root].mcpServers.demo.command).toBe("local-other"); expect(config.mcpServers.demo.env).toEqual(definition().env);
  }, 30_000);
});

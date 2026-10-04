import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { PluginInfo, Schedule } from "./types.js";

const scheduleSchema = z.object({ name: z.string().min(1).regex(/^[\p{L}\p{N}._-]+$/u), provider: z.string().min(1).regex(/^[\w.-]+$/), model: z.string().min(1), prompt: z.string().min(1), cron: z.string().min(1), cwd: z.string().min(1), timeZone: z.string().min(1), createdAt: z.string().datetime() });
const pluginSchema = z.object({ provider: z.string().min(1), name: z.string().min(1), version: z.string().optional(), sourcePath: z.string().min(1), installedAt: z.string().datetime(), providerId: z.string().min(1) });
const scheduleEnvelope = z.object({ version: z.literal(1), schedules: z.array(scheduleSchema) });
const pluginEnvelope = z.object({ version: z.literal(1), plugins: z.array(pluginSchema) });
export const stateRoot = () => join(process.env.HERA_HOME || homedir(), ".hera");
export const statePath = (file: string) => join(stateRoot(), file);
export const runtimePath = (file: string) => join(stateRoot(), "runtime", file);
export const logPath = (provider: string, name: string) => {
  if (!/^[\p{L}\p{N}._-]+$/u.test(name) || name === "." || name === "..") throw new Error("Unsafe session name");
  return join(stateRoot(), provider, `${name}.log`);
};

export async function locked<T>(file: string, work: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 10_000;
  let handle;
  while (!handle) {
    try { handle = await open(lock, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const age = Date.now() - (await stat(lock)).mtimeMs;
        if (age > 60_000) { await rm(lock, { force: true }); continue; }
      } catch { continue; }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for state lock ${lock}`);
      await delay(25);
    }
  }
  try { return await work(); }
  finally { await handle.close(); await rm(lock, { force: true }); }
}

export async function readEnvelope<T>(file: string, parser: z.ZodType<T>, empty: T): Promise<T> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    return parser.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
export async function writeAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temp, file); } catch (error) { await rm(temp, { force: true }); throw error; }
}

export async function readSchedules(): Promise<Schedule[]> {
  const value = await readEnvelope(statePath("schedule.json"), scheduleEnvelope, { version: 1, schedules: [] });
  return value.schedules;
}
export async function saveSchedule(schedule: Schedule): Promise<void> {
  const file = statePath("schedule.json");
  await locked(file, async () => {
    const data = await readEnvelope(file, scheduleEnvelope, { version: 1, schedules: [] });
    const existing = data.schedules.find((item) => item.name === schedule.name);
    if (existing) {
      const old = { ...existing }; const next = { ...schedule };
      delete (old as Partial<Schedule>).createdAt; delete (next as Partial<Schedule>).createdAt;
      if (JSON.stringify(old) !== JSON.stringify(next)) throw new Error(`Schedule name '${schedule.name}' already exists with different settings.`);
      return;
    }
    await writeAtomic(file, { ...data, schedules: [...data.schedules, schedule] });
  });
}
export async function removeSchedule(name: string): Promise<boolean> {
  const file = statePath("schedule.json");
  return locked(file, async () => {
    const data = await readEnvelope(file, scheduleEnvelope, { version: 1, schedules: [] });
    if (!data.schedules.some((item) => item.name === name)) return false;
    await writeAtomic(file, { ...data, schedules: data.schedules.filter((item) => item.name !== name) });
    return true;
  });
}
export async function readPlugins(): Promise<PluginInfo[]> {
  const value = await readEnvelope(statePath("plugins.json"), pluginEnvelope, { version: 1, plugins: [] });
  return value.plugins.map((item) => {
    const { version, ...rest } = item;
    return version === undefined ? rest : { ...rest, version };
  });
}
export async function appendPlugin(plugin: PluginInfo): Promise<void> {
  const file = statePath("plugins.json");
  await locked(file, async () => {
    const data = await readEnvelope(file, pluginEnvelope, { version: 1, plugins: [] });
    const plugins = data.plugins.filter((item) => item.provider !== plugin.provider || item.name !== plugin.name);
    await writeAtomic(file, { ...data, plugins: [...plugins, plugin] });
  });
}

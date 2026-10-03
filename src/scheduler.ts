import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { Cron } from "croner";
import { runtimePath } from "./storage.js";
import { readSchedules } from "./storage.js";
import { providers } from "./providers/index.js";
import { execute } from "./runner.js";
import type { Schedule } from "./types.js";
import { resolve } from "node:path";

type Lease = { pid: number; token: string; heartbeat: number; ready: boolean };
const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const scheduleKey = (name: string) => createHash("sha256").update(name).digest("hex");
async function leaseData(): Promise<Lease | null> {
  try { return JSON.parse(await readFile(runtimePath("scheduler.json"), "utf8")) as Lease; } catch { return null; }
}
export async function schedulerStatus(): Promise<string> {
  const lease = await leaseData();
  if (!lease?.ready || Date.now() - lease.heartbeat > 15_000) return "inactive";
  try { process.kill(lease.pid, 0); return "running"; } catch { return "inactive"; }
}
export async function ensureScheduler(): Promise<void> {
  const file = runtimePath("scheduler.json");
  const launchLock = runtimePath("scheduler-launch.lock");
  await mkdir(runtimePath("."), { recursive: true, mode: 0o700 });
  let lock;
  const lockDeadline = Date.now() + 10_000;
  while (!lock) {
    if (await schedulerStatus() === "running") return;
    try { lock = await open(launchLock, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= lockDeadline) throw new Error("Timed out waiting for another Hera scheduler startup.");
      await sleep(100);
    }
  }
  try {
    if (await schedulerStatus() === "running") return;
    const lease = await leaseData();
    if (lease) {
      let alive = false;
      if (Date.now() - lease.heartbeat <= 15_000) {
        try { process.kill(lease.pid, 0); alive = true; } catch { /* Stale owner. */ }
      }
      if (!alive) await rm(file, { force: true });
    }
    const entry = process.argv[1];
    if (!entry) throw new Error("Cannot locate Hera executable for background scheduler.");
    const command = entry.endsWith(".ts") ? [resolve("node_modules/tsx/dist/cli.mjs"), entry, "internal", "scheduler"] : [entry, "internal", "scheduler"];
    const child = spawn(process.execPath, command, { detached: true, stdio: "ignore", cwd: process.cwd(), env: process.env });
    child.unref();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await sleep(100);
      const current = await leaseData();
      if (current?.ready && current.pid === child.pid) return;
      if (child.exitCode !== null || child.signalCode) break;
    }
    throw new Error("Background scheduler did not become ready.");
  } finally { await lock.close(); await rm(launchLock, { force: true }); }
}

export async function runScheduler(): Promise<void> {
  const file = runtimePath("scheduler.json");
  await mkdir(runtimePath("."), { recursive: true, mode: 0o700 });
  const handle = await open(file, "wx", 0o600).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    const existing = await leaseData();
    if (existing) {
      if (Date.now() - existing.heartbeat <= 15_000) {
        try { process.kill(existing.pid, 0); throw new Error("Another Hera scheduler is already active."); } catch (inner) { if (inner instanceof Error && inner.message.includes("already active")) throw inner; }
      }
    }
    await rm(file, { force: true }); return open(file, "wx", 0o600);
  });
  const token = randomUUID(); let active = true;
  const writeLease = async (ready: boolean) => {
    await writeFile(file, JSON.stringify({ pid: process.pid, token, heartbeat: Date.now(), ready } satisfies Lease), { mode: 0o600 });
  };
  const inflight = new Map<string, Promise<void>>();
  const nextRuns = new Map<string, number>();
  let emptySince: number | undefined;
  await handle.close(); await writeLease(true);
  const heartbeat = setInterval(() => { void writeLease(true); }, 2_000);
  const shutdown = () => { active = false; };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  try {
    while (active) {
      const schedules = await readSchedules();
      if (!schedules.length) {
        emptySince ??= Date.now();
        if (!inflight.size && Date.now() - emptySince > 2_000) break;
      } else emptySince = undefined;
      const currentNames = new Set(schedules.map((s) => s.name));
      for (const name of nextRuns.keys()) if (!currentNames.has(name) && !inflight.has(name)) nextRuns.delete(name);
      const now = Date.now();
      for (const item of schedules) {
        const job = new Cron(item.cron, { timezone: item.timeZone });
        const due = job.nextRun(new Date(now - 1_000));
        const dueTime = due?.getTime();
        if (!dueTime || dueTime > now + 250) continue;
        const last = nextRuns.get(item.name);
        if (last === dueTime) continue;
        nextRuns.set(item.name, dueTime);
        if (inflight.has(item.name)) {
          await writeFile(runtimePath("scheduler.log"), `${new Date().toISOString()} skipped overlapping schedule ${item.name}\n`, { flag: "a", mode: 0o600 });
          continue;
        }
        const task = runScheduled(item, dueTime).finally(() => inflight.delete(item.name));
        inflight.set(item.name, task);
      }
      await sleep(250);
    }
  } finally {
    active = false; clearInterval(heartbeat); await Promise.allSettled(inflight.values());
    process.off("SIGTERM", shutdown); process.off("SIGINT", shutdown);
    await writeFile(runtimePath("scheduler.log"), `${new Date().toISOString()} scheduler stopped\n`, { flag: "a", mode: 0o600 });
    const current = await leaseData(); if (current?.token === token) await rm(file, { force: true });
  }
}

async function runScheduled(item: Schedule, occurrence: number): Promise<void> {
  const claimDir = runtimePath("claims");
  const activeDir = runtimePath("active");
  await mkdir(claimDir, { recursive: true, mode: 0o700 }); await mkdir(activeDir, { recursive: true, mode: 0o700 });
  const key = scheduleKey(item.name);
  if (!await claimOccurrence(item.name, occurrence)) return;
  const activeFile = runtimePath(`active/${key}.json`);
  const token = randomUUID();
  let active;
  try { active = await open(activeFile, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      const record = JSON.parse(await readFile(activeFile, "utf8")) as { schedulerPid?: number; childPid?: number };
      const ownerPid = record.childPid ?? record.schedulerPid;
      if (ownerPid) {
        let ownerAlive = false;
        try { process.kill(ownerPid, 0); ownerAlive = true; } catch { /* Owner has exited. */ }
        if (ownerAlive) {
          await appendSchedulerLog(`skipped overlapping schedule ${item.name}`);
          return;
        }
      }
    } catch { /* Malformed stale marker; replace it below. */ }
    await rm(activeFile, { force: true });
    try { active = await open(activeFile, "wx", 0o600); }
    catch (retryError) { if ((retryError as NodeJS.ErrnoException).code === "EEXIST") return; throw retryError; }
  }
  const writeActive = async (childPid?: number) => {
    const data = JSON.stringify({ token, schedule: item.name, occurrence, schedulerPid: process.pid, ...(childPid ? { childPid } : {}) });
    await active.truncate(0); await active.writeFile(data); await active.sync();
  };
  try {
    await writeActive();
    const provider = providers.get(item.provider);
    await execute(provider, { model: item.model, prompt: item.prompt, cwd: item.cwd, sessionName: item.name, scheduled: true, onChildSpawn: async (pid) => writeActive(pid) });
  } catch (error) {
    await appendSchedulerLog(`schedule ${item.name} occurrence ${occurrence} failed: ${String(error)}`);
  } finally {
    await active.close();
    try {
      const record = JSON.parse(await readFile(activeFile, "utf8")) as { token?: string };
      if (record.token === token) await rm(activeFile, { force: true });
    } catch { /* The marker was already removed during recovery. */ }
  }
}

export async function claimOccurrence(name: string, occurrence: number): Promise<boolean> {
  const key = scheduleKey(name);
  const claimFile = runtimePath(`claims/${key}-${occurrence}.json`);
  await mkdir(runtimePath("claims"), { recursive: true, mode: 0o700 });
  let claim;
  try { claim = await open(claimFile, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  try { await claim.writeFile(JSON.stringify({ name, occurrence, claimedAt: new Date().toISOString() })); await claim.sync(); }
  finally { await claim.close(); }
  return true;
}

async function appendSchedulerLog(message: string): Promise<void> {
  await mkdir(runtimePath("."), { recursive: true, mode: 0o700 });
  await writeFile(runtimePath("scheduler.log"), `${new Date().toISOString()} ${message}\n`, { flag: "a", mode: 0o600 });
}

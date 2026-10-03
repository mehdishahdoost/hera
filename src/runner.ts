import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { logPath } from "./storage.js";
import type { Provider, RunRequest, ProviderResult } from "./types.js";

export async function execute(provider: Provider, request: RunRequest): Promise<ProviderResult> {
  const file = logPath(provider.name, request.sessionName);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const log = await open(file, "a", 0o600);
  const id = `${Date.now()}-${process.pid}`;
  const write = async (text: string) => { await log.appendFile(text); };
  try { await write(`\n=== execution ${id} started ${new Date().toISOString()} ===\n`); }
  catch (error) { await log.close(); throw error; }
  let failed: Error | undefined;
  const emit = async (stream: "stdout" | "stderr", text: string) => {
    (stream === "stdout" ? process.stdout : process.stderr).write(text);
    try { await write(`[${stream}] ${text}`); }
    catch (error) { failed = error as Error; throw error; }
  };
  let result: ProviderResult;
  const { onChildSpawn, ...providerRequest } = request;
  try { result = await provider.run(providerRequest, emit, onChildSpawn); }
  catch (error) { result = { exitCode: 1 }; failed ??= error as Error; }
  try {
    if (failed) await write(`\n=== execution ${id} failed ${new Date().toISOString()} ${failed.message} ===\n`);
    else await write(`\n=== execution ${id} finished ${new Date().toISOString()} exit=${result.exitCode} ===\n`);
  } finally { await log.close(); }
  if (failed) throw new Error(failed.message);
  return result;
}

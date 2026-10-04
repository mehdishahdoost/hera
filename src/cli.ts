import { Command, CommanderError, InvalidArgumentError } from "commander";
import { resolve } from "node:path";
import { appendPlugin, readPlugins, readSchedules, removeSchedule, saveSchedule } from "./storage.js";
import { providers } from "./providers/index.js";
import { execute } from "./runner.js";
import { ensureScheduler, schedulerStatus } from "./scheduler.js";
import type { Schedule } from "./types.js";
import { createSessionName } from "./session-name.js";
import { addMcp, SelectionCancelled } from "./mcp.js";

const required = (value: string | undefined, flag: string): string => {
  if (!value?.trim()) throw new InvalidArgumentError(`${flag} must not be empty`);
  return value;
};
const parseProvider = (value: string | undefined) => required(value, "--provider");
const parsePrompt = (value: string | undefined) => required(value, "--prompt");
const parseModel = (value: string | undefined) => required(value, "--model");

export const program = new Command().name("hera").description("Orchestrate local AI agent CLIs").version("0.1.0");
program.enablePositionalOptions();
program.action(() => { program.outputHelp(); });
program.command("run")
  .requiredOption("--provider <name>", "Agent provider", parseProvider)
  .requiredOption("--model <model>", "Provider model", parseModel)
  .requiredOption("--prompt <prompt>", "Prompt to run", parsePrompt)
  .action(async (options: { provider: string; model: string; prompt: string }) => {
    const provider = providers.get(options.provider);
    const sessionName = createSessionName();
    console.error(`Session: ${sessionName}\nLog: ~/.hera/${provider.name}/${sessionName}.log`);
    const result = await execute(provider, { ...options, cwd: process.cwd(), sessionName });
    if (result.exitCode !== 0) process.exitCode = result.exitCode;
  });

program.command("schedule")
  .option("--provider <name>", "Agent provider", parseProvider)
  .option("--model <model>", "Provider model", parseModel)
  .option("--prompt <prompt>", "Prompt to run", parsePrompt)
  .option("--cron <expression>", "Five-field cron expression")
  .option("--name <name>", "Unique schedule name")
  .action(async (options: Partial<Omit<Schedule, "cwd" | "timeZone" | "createdAt">>) => {
    const createOptions = {
      provider: required(options.provider, "--provider"), model: required(options.model, "--model"),
      prompt: required(options.prompt, "--prompt"), cron: required(options.cron, "--cron"), name: required(options.name, "--name")
    };
    if (createOptions.cron.trim().split(/\s+/).length !== 5) throw new Error("--cron must be a valid five-field cron expression.");
    try { new (await import("croner")).Cron(createOptions.cron); }
    catch { throw new Error("--cron must be a valid five-field cron expression."); }
    providers.get(createOptions.provider);
    const schedule: Schedule = {
      ...createOptions, cwd: process.cwd(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      createdAt: new Date().toISOString()
    };
    await saveSchedule(schedule);
    try { await ensureScheduler(); }
    catch (error) { throw new Error(`Schedule '${schedule.name}' was saved but is inactive: ${String(error)}`); }
    console.log(`Scheduled '${schedule.name}'.`);
  });
const schedule = program.commands.find((command) => command.name() === "schedule")!;
schedule.command("remove <name>").action(async (name: string) => {
  if (!await removeSchedule(name)) throw new Error(`No schedule named '${name}'.`);
  console.log(`Removed '${name}'.`);
});

const list = program.command("list").description("List Hera resources");
list.command("schedule").description("List saved schedules").action(async () => {
  const schedules = await readSchedules();
  if (!schedules.length) { console.log("No schedules."); return; }
  const state = await schedulerStatus();
  for (const item of schedules) console.log(`${item.name}\t${item.provider}\t${item.model}\t${item.cron}\t${item.timeZone}\t${state}`);
});
list.command("plugins").description("List Hera-managed plugins").action(async () => {
  const plugins = await readPlugins();
  if (!plugins.length) { console.log("No Hera-managed plugins."); return; }
  for (const item of plugins) console.log(`${item.name}\t${item.provider}\t${item.sourcePath}\t${item.installedAt}`);
});
list.command("models").description("List models for a provider")
  .requiredOption("--provider <name>", "Agent provider", parseProvider)
  .action(async (options: { provider: string }) => {
    for (const model of await providers.get(options.provider).listModels()) console.log(`${model.id}\t${model.name}`);
  });

program.command("plugin").description("Manage provider plugins")
  .command("install").requiredOption("--provider <name>", "Agent provider", parseProvider)
  .requiredOption("--path <path>", "Local plugin path")
  .action(async (options: { provider: string; path: string }) => {
    const plugin = await providers.get(options.provider).installPlugin({ path: resolve(options.path) });
    await appendPlugin(plugin);
    console.log(`Installed '${plugin.name}' for ${plugin.provider}.`);
  });

class McpAddCommand extends Command {
  hasDelimiter = false;
  commandArgs: string[] = [];
  override parseOptions(argv: string[]) {
    this.hasDelimiter = false;
    this.commandArgs = [];
    for (let index = 0; index < argv.length; index++) {
      if (argv[index] === "--env") { index++; continue; }
      if (argv[index] === "--") { this.hasDelimiter = index < argv.length - 1; this.commandArgs = argv.slice(index + 1); break; }
    }
    return super.parseOptions(argv);
  }
}
const mcpAdd = new McpAddCommand("add").argument("<name>").argument("<command...>")
  .description("Save a stdio server, then select installed platforms. Separate executable and arguments with --.")
  .option("--env <KEY=value>", "Server environment assignment (repeatable)", (value: string, previous: string[]) => [...previous, value], [])
  .action(async (name: string, command: string[], options: { env: string[] }) => {
    // Commander consumes the delimiter. Check the original argv so accidental
    // command positionals without -- cannot be silently accepted.
    if (!mcpAdd.hasDelimiter) throw new Error("MCP command must follow an explicit -- delimiter.");
    if (JSON.stringify(command) !== JSON.stringify(mcpAdd.commandArgs)) throw new Error("Place the executable and all server arguments after --.");
    const code = await addMcp(name, command, options.env);
    if (code) process.exitCode = code;
  });
program.command("mcp").enablePositionalOptions().description("Manage saved MCP server definitions").addCommand(mcpAdd);

program.command("internal", { hidden: true }).command("scheduler", { hidden: true }).action(async () => {
  const { runScheduler } = await import("./scheduler.js"); await runScheduler();
});
program.exitOverride();
export async function main(argv = process.argv): Promise<void> {
  try { await program.parseAsync(argv); }
  catch (error) {
    if (error instanceof SelectionCancelled) { console.error(error.message); process.exitCode = 130; return; }
    if (error instanceof CommanderError) { process.exitCode = error.exitCode; return; }
    if (error instanceof Error) { console.error(error.message); process.exitCode = 1; return; }
    throw error;
  }
}

import { z } from "zod";
import { locked, readEnvelope, statePath, writeAtomic } from "./storage.js";

export const serverName = z.string().regex(/^[A-Za-z0-9._-]+$/).refine((name) => name !== "." && name !== ".." && !name.startsWith("-"));
const literal = z.string().refine((value) => !value.includes("\0"));
const objectRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
// Zod's record cloning drops __proto__. Validate records without cloning so
// accepted literal keys survive disk round trips, using own entries only.
const envSchema = z.custom<Record<string, string>>((value) => objectRecord(value)
  && Object.entries(value).every(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && literal.safeParse(item).success));
export const definitionSchema = z.object({
  command: literal.refine((value) => !!value.trim()), args: z.array(literal),
  env: envSchema
}).strict();
export type McpDefinition = z.infer<typeof definitionSchema>;
const serversSchema = z.custom<Record<string, McpDefinition>>((value) => objectRecord(value)
  && Object.entries(value).every(([key, item]) => serverName.safeParse(key).success && definitionSchema.safeParse(item).success));
const envelope = z.object({ version: z.literal(1), servers: serversSchema }).strict();

export function parseDefinition(name: string, command: string[], assignments: string[]): McpDefinition {
  if (!serverName.safeParse(name).success) throw new Error("Invalid MCP name: use letters, numbers, dots, underscores, or hyphens; do not begin with a hyphen.");
  const env: Record<string, string> = Object.create(null);
  for (const assignment of assignments) {
    const index = assignment.indexOf("=");
    if (index < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(assignment.slice(0, index))) throw new Error("--env requires KEY=value with a valid environment key.");
    env[assignment.slice(0, index)] = assignment.slice(index + 1);
  }
  const result = definitionSchema.safeParse({ command: command[0], args: command.slice(1), env });
  if (!result.success) throw new Error("Invalid MCP definition: an executable is required after -- and values cannot contain NUL.");
  return result.data;
}

export function identicalDefinition(left: McpDefinition, right: McpDefinition): boolean {
  return left.command === right.command && JSON.stringify(left.args) === JSON.stringify(right.args)
    && JSON.stringify(Object.entries(left.env).sort()) === JSON.stringify(Object.entries(right.env).sort());
}

export async function readMcpDefinitions() {
  // Validation errors must not echo secret-bearing persisted values.
  try { return await readEnvelope(statePath("mcp.config"), envelope, { version: 1, servers: {} }); }
  catch { throw new Error("Cannot read mcp.config: invalid, unsupported, or unreadable registry; original file preserved."); }
}

export async function saveMcpDefinition(name: string, definition: McpDefinition): Promise<void> {
  if (!serverName.safeParse(name).success || !definitionSchema.safeParse(definition).success) throw new Error("Invalid MCP definition.");
  await locked(statePath("mcp.config"), async () => {
    const data = await readMcpDefinitions();
    const existing = Object.hasOwn(data.servers, name) ? data.servers[name] : undefined;
    if (existing && !identicalDefinition(existing, definition)) throw new Error(`MCP name '${name}' already exists with different settings.`);
    await writeAtomic(statePath("mcp.config"), { version: 1, servers: { ...data.servers, [name]: definition } });
  });
}

import { randomBytes } from "node:crypto";

export function createSessionName(now = new Date()): string {
  const timestamp = now.toISOString().replaceAll(/[-:.TZ]/g, "");
  return `run-${timestamp}-${randomBytes(3).toString("hex")}`;
}

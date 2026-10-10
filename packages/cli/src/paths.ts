import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Env = Record<string, string | undefined>;

export const agentariumHome = (env: Env = process.env): string =>
  env.AGENTARIUM_HOME || join(homedir(), ".agentarium");

/** User-level Claude Code settings. */
export const claudeSettingsPath = (env: Env = process.env): string =>
  join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");

export const codexHooksPath = (env: Env = process.env): string =>
  join(env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json");

export const dataDir = (home: string): string => join(home, "data");
export const daemonFile = (home: string): string => join(home, "daemon.json");
export const logFile = (home: string): string => join(home, "daemon.log");

/** The shared secret for ingest and the UI; created on first use. */
export function readOrCreateToken(home: string): string {
  const file = join(home, "token");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // fall through and create
  }
  mkdirSync(home, { recursive: true });
  const token = randomBytes(24).toString("hex");
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

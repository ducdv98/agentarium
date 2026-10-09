import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DAEMON_VERSION, resolvePort } from "@agentarium/server";
import {
  agentariumHome,
  claudeSettingsPath,
  daemonFile,
  logFile,
  readOrCreateToken,
  type Env,
} from "./paths";
import { installHooks, uninstallHooks, type InstallResult, type UninstallResult } from "./settings";

export interface Context {
  env: Env;
  home: string;
  settingsPath: string;
  port: number;
}

export function contextFromEnv(env: Env = process.env): Context {
  return { env, home: agentariumHome(env), settingsPath: claudeSettingsPath(env), port: resolvePort(env) };
}

export function init(ctx: Context): InstallResult & { settingsPath: string; port: number } {
  const token = readOrCreateToken(ctx.home);
  return {
    ...installHooks(ctx.settingsPath, { port: ctx.port, token }),
    settingsPath: ctx.settingsPath,
    port: ctx.port,
  };
}

export function uninstall(ctx: Context): UninstallResult & { settingsPath: string } {
  return { ...uninstallHooks(ctx.settingsPath), settingsPath: ctx.settingsPath };
}

interface Health {
  app: string;
  version: string;
  pid: number;
}

export async function probeHealth(port: number): Promise<Health | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
    const body = (await res.json()) as Partial<Health>;
    return body.app === "agentarium" && typeof body.version === "string" && typeof body.pid === "number"
      ? (body as Health)
      : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(cond: () => Promise<boolean>, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await cond()) return true;
  return false;
}

export type StartResult = { status: "started" | "already-running"; port: number; pid: number };

/** Starts the detached daemon. Refuses when a daemon of a different version holds the port. */
export async function start(ctx: Context): Promise<StartResult> {
  const running = await probeHealth(ctx.port);
  if (running) {
    if (running.version !== DAEMON_VERSION) {
      throw new Error(
        `agentarium daemon v${running.version} is already running on port ${ctx.port} (this is v${DAEMON_VERSION}). Run "agentarium stop" first.`,
      );
    }
    return { status: "already-running", port: ctx.port, pid: running.pid };
  }
  readOrCreateToken(ctx.home);
  const out = openSync(logFile(ctx.home), "a");
  // tsx lets the daemon run straight from TypeScript sources until there is a build step.
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const entry = fileURLToPath(new URL("./daemon-main.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", tsx, entry], {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, ...ctx.env, AGENTARIUM_HOME: ctx.home, AGENTARIUM_PORT: String(ctx.port) },
  });
  let exited = false;
  child.on("exit", () => (exited = true));
  child.unref();
  const up = await waitFor(async () => exited || (await probeHealth(ctx.port)) !== null, 15_000);
  const health = up && !exited ? await probeHealth(ctx.port) : null;
  if (!health) throw new Error(`daemon failed to start; see ${logFile(ctx.home)}`);
  return { status: "started", port: ctx.port, pid: health.pid };
}

export type StopResult = { status: "stopped" | "not-running"; pid?: number };

export async function stop(ctx: Context): Promise<StopResult> {
  const file = daemonFile(ctx.home);
  let port = ctx.port;
  if (existsSync(file)) {
    try {
      port = (JSON.parse(readFileSync(file, "utf8")) as { port: number }).port;
    } catch {
      // stale or corrupt: use the configured port
    }
  }
  const health = await probeHealth(port);
  rmSync(file, { force: true });
  if (!health) return { status: "not-running" };
  process.kill(health.pid);
  if (!(await waitFor(async () => (await probeHealth(port)) === null, 5_000))) {
    throw new Error(`daemon (pid ${health.pid}) did not stop`);
  }
  return { status: "stopped", pid: health.pid };
}

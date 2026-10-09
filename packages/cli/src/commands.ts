import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  /** The built daemon script `start` runs; the default only exists in the bundle, not from src/. */
  daemonEntry: string;
}

export function contextFromEnv(env: Env = process.env): Context {
  return {
    env,
    home: agentariumHome(env),
    settingsPath: claudeSettingsPath(env),
    port: resolvePort(env),
    // Next to the bundled CLI: dist/bin.js runs dist/daemon.js.
    daemonEntry: fileURLToPath(new URL("./daemon.js", import.meta.url)),
  };
}

export type InitResult = InstallResult & { settingsPath: string; port: number } & (
  | { daemon: "not-running" }
  | { daemon: "running" | "other-version"; version: string }
);

export async function init(ctx: Context): Promise<InitResult> {
  const token = readOrCreateToken(ctx.home);
  const installed = installHooks(ctx.settingsPath, { port: ctx.port, token });
  const running = await probeHealth(ctx.port);
  return {
    ...installed,
    settingsPath: ctx.settingsPath,
    port: ctx.port,
    ...(running
      ? {
          daemon: running.version === DAEMON_VERSION ? ("running" as const) : ("other-version" as const),
          version: running.version,
        }
      : { daemon: "not-running" as const }),
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

export function differentVersionMessage(version: string, port: number): string {
  return `agentarium daemon v${version} is already running on port ${port} (this is v${DAEMON_VERSION}). Run "agentarium stop" first.`;
}

/** Starts the detached daemon. Refuses when a daemon of a different version holds the port. */
export async function start(ctx: Context): Promise<StartResult> {
  const running = await probeHealth(ctx.port);
  if (running) {
    if (running.version !== DAEMON_VERSION) {
      throw new Error(differentVersionMessage(running.version, ctx.port));
    }
    return { status: "already-running", port: ctx.port, pid: running.pid };
  }
  if (!existsSync(ctx.daemonEntry)) {
    throw new Error(`daemon script not found at ${ctx.daemonEntry}; run "pnpm build" first`);
  }
  readOrCreateToken(ctx.home);
  const out = openSync(logFile(ctx.home), "a");
  const child = spawn(process.execPath, [ctx.daemonEntry], {
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

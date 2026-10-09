import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { DAEMON_VERSION } from "@agentarium/server";
import { contextFromEnv, init, probeHealth, start, stop, uninstall, type Context } from "../src/commands";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

const runInit = (ctx: Context) =>
  promisify(execFile)(process.execPath, [fileURLToPath(new URL("../dist/bin.js", import.meta.url)), "init"], {
    env: { ...process.env, ...ctx.env },
    windowsHide: true,
  });

const made: Context[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((c) => stop(c).catch(() => {})));
});

async function setup(): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), "agentarium-cli-"));
  const port = await freePort();
  const ctx = {
    ...contextFromEnv({
      AGENTARIUM_HOME: join(dir, "home"),
      CLAUDE_CONFIG_DIR: join(dir, "claude"),
      AGENTARIUM_PORT: String(port),
    }),
    // Bundled by the global setup.
    daemonEntry: fileURLToPath(new URL("../dist/daemon.js", import.meta.url)),
  };
  made.push(ctx);
  return ctx;
}

describe("init/uninstall", () => {
  it("writes the real port, is idempotent, and uninstall removes it", async () => {
    const ctx = await setup();
    await init(ctx);
    expect(readFileSync(ctx.settingsPath, "utf8")).toContain(`:${ctx.port}/hooks/claude-code`);
    expect((await init(ctx)).changed).toBe(false);
    uninstall(ctx);
    expect(existsSync(ctx.settingsPath)).toBe(false);
  });

  it("reports a running daemon and stays idempotent", async () => {
    const ctx = await setup();
    await start(ctx);

    expect(await init(ctx)).toMatchObject({ changed: true, daemon: "running" });
    expect(await init(ctx)).toMatchObject({ changed: false, daemon: "running" });
    const { stdout, stderr } = await runInit(ctx);
    expect(stdout.trim().split(/\r?\n/)).toEqual([`Hooks already up to date in ${ctx.settingsPath}.`]);
    expect(stderr).toBe("");
  }, 30_000);

  it("reports when the daemon is not running after writing hooks", async () => {
    const ctx = await setup();

    expect(await init(ctx)).toMatchObject({ changed: true, daemon: "not-running" });
    expect(readFileSync(ctx.settingsPath, "utf8")).toContain(`:${ctx.port}/hooks/claude-code`);
    const { stdout, stderr } = await runInit(ctx);
    expect(stdout.trim().split(/\r?\n/)).toEqual([
      `Hooks already up to date in ${ctx.settingsPath}.`,
      "Hooks will do nothing until the daemon runs. Start it with: agentarium start",
    ]);
    expect(stderr).toBe("");
  });

  it("reports a different daemon version without failing", async () => {
    const ctx = await setup();
    const server = createHttpServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ app: "agentarium", version: "0.0.0-other", pid: 1 }));
      } else {
        res.writeHead(404).end();
      }
    });
    try {
      await new Promise<void>((resolve) => server.listen(ctx.port, "127.0.0.1", resolve));

      expect(await init(ctx)).toMatchObject({
        changed: true,
        daemon: "other-version",
        version: "0.0.0-other",
      });
      const hint = `agentarium daemon v0.0.0-other is already running on port ${ctx.port} (this is v${DAEMON_VERSION}). Run "agentarium stop" first.`;
      await expect(start(ctx)).rejects.toThrow(hint);
      const { stdout, stderr } = await runInit(ctx);
      expect(stdout.trim().split(/\r?\n/)).toEqual([
        `Hooks already up to date in ${ctx.settingsPath}.`,
        hint,
      ]);
      expect(stderr).toBe("");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("start/stop", () => {
  it("runs a detached daemon that accepts a hook, and stops it", async () => {
    const ctx = await setup();
    await init(ctx);
    const token = readFileSync(join(ctx.home, "token"), "utf8").trim();
    expect((await start(ctx)).status).toBe("started");
    expect((await start(ctx)).status).toBe("already-running");

    const res = await fetch(`http://127.0.0.1:${ctx.port}/hooks/claude-code`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s", hook_event_name: "UserPromptSubmit", cwd: ctx.home }),
    });
    expect(res.status).toBe(204);

    expect((await stop(ctx)).status).toBe("stopped");
    expect(await probeHealth(ctx.port)).toBeNull();
    expect((await stop(ctx)).status).toBe("not-running");
  }, 30_000);

  it("a down daemon fails fast, so a hook can never hang a session", async () => {
    const ctx = await setup();
    const t0 = Date.now();
    await expect(
      fetch(`http://127.0.0.1:${ctx.port}/hooks/claude-code`, { method: "POST", body: "{}" }),
    ).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

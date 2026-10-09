import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contextFromEnv, init, probeHealth, start, stop, uninstall, type Context } from "../src/commands";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

const made: Context[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((c) => stop(c).catch(() => {})));
});

async function setup(): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), "agentarium-cli-"));
  const port = await freePort();
  const ctx = contextFromEnv({
    AGENTARIUM_HOME: join(dir, "home"),
    CLAUDE_CONFIG_DIR: join(dir, "claude"),
    AGENTARIUM_PORT: String(port),
  });
  made.push(ctx);
  return ctx;
}

describe("init/uninstall", () => {
  it("writes the real port, is idempotent, and uninstall removes it", async () => {
    const ctx = await setup();
    init(ctx);
    expect(readFileSync(ctx.settingsPath, "utf8")).toContain(`:${ctx.port}/hooks/claude-code`);
    expect(init(ctx).changed).toBe(false);
    uninstall(ctx);
    expect(existsSync(ctx.settingsPath)).toBe(false);
  });
});

describe("start/stop", () => {
  it("runs a detached daemon that accepts a hook, and stops it", async () => {
    const ctx = await setup();
    init(ctx);
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

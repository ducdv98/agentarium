import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { forwardCodexHook } from "../src/codex-hook";
import { backupPath, codexTarget, installHooks, uninstallHooks } from "../src/settings";
import { contextFromEnv, init } from "../src/commands";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "agentarium-codex-")); dirs.push(d); return d; };
afterEach(async () => { const { rmSync } = await import("node:fs"); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("Codex hooks", () => {
  it("installs idempotently and restores original bytes while keeping user hooks", () => {
    const path = join(dir(), "hooks.json");
    const original = '{\n  "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "echo user" }] }] }\n}\n';
    writeFileSync(path, original);
    const target = codexTarget(47821, "/tmp/agentarium cli.js", "/tmp/agentarium home");
    const opts = { port: 47821, token: "private" };
    expect(installHooks(path, opts, {}, target)).toEqual({ changed: true, backedUp: true });
    const written = readFileSync(path, "utf8");
    expect(JSON.parse(written).hooks.SessionStart[0].hooks[0].command).toContain('"/tmp/agentarium cli.js" hook codex --port 47821 --home "/tmp/agentarium home"');
    expect(written).not.toContain("private");
    expect(JSON.parse(written).hooks.Stop).toHaveLength(2);
    expect(installHooks(path, opts, {}, target).changed).toBe(false);
    expect(uninstallHooks(path, {}, target).restoredBackup).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(backupPath(path))).toBe(false);
  });
  it("quotes shell metacharacters in the CLI path", () => {
    const command = codexTarget(1, '/tmp/a "$(touch /tmp/nope)`x\\y', "/h").handler.command;
    expect(command).toContain('\\"');
    expect(command).toContain('\\$');
    expect(command).toContain('\\`');
    expect(command).toContain('\\\\');
  });
  it("refuses destructive reshape", () => {
    const path = join(dir(), "hooks.json");
    writeFileSync(path, '{"hooks":{"Interrupt":null}}');
    expect(() => installHooks(path, { port: 1, token: "" }, {}, codexTarget(1, "/cli", "/h"))).toThrow(/hooks\.Interrupt must be an array/);
    expect(readFileSync(path, "utf8")).toBe('{"hooks":{"Interrupt":null}}');
  });
  it("skips Codex install when its home does not exist", async () => {
    const base = dir();
    const ctx = contextFromEnv({ AGENTARIUM_HOME: join(base, "data"), CLAUDE_CONFIG_DIR: join(base, "claude"), CODEX_HOME: join(base, "missing"), AGENTARIUM_PORT: "0" });
    expect((await init(ctx)).codex).toBe("skipped");
    expect(existsSync(ctx.codexHooksPath)).toBe(false);
  });
});

describe("Codex hook forwarder", () => {
  it("posts raw input with the token", async () => {
    const home = dir();
    writeFileSync(join(home, "token"), "test-token\n");
    let received = "";
    const server = createServer((req, res) => {
      expect(req.url).toBe("/hooks/codex");
      expect(req.headers.authorization).toBe("Bearer test-token");
      req.on("data", (c) => received += c.toString());
      req.on("end", () => res.writeHead(204).end());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      if (!address || typeof address === "string") throw new Error("no port");
      await forwardCodexHook({ home, port: address.port, stdin: Readable.from(['{"a":1}']) });
      expect(received).toBe('{"a":1}');
    } finally { server.close(); }
  });
  it("the CLI exits zero with no output when its token is missing", async () => {
    const home = dir();
    const cli = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [cli, "hook", "codex", "--port", "1"], {
      env: { ...process.env, AGENTARIUM_HOME: home },
    });
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
  it("is silent with missing token or daemon", async () => {
    const home = dir();
    await expect(forwardCodexHook({ home, port: 1, stdin: Readable.from(["{}"] ) })).resolves.toBeUndefined();
    writeFileSync(join(home, "token"), "token");
    await expect(forwardCodexHook({ home, port: 1, stdin: Readable.from(["{}"] ) })).resolves.toBeUndefined();
  });
});

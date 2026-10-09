import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HOOK_EVENTS, HOOK_TIMEOUT_S, backupPath, installHooks, uninstallHooks } from "../src/settings";

const opts = { port: 47821, token: "tok" };
let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "agentarium-settings-")), "settings.json");
});
const read = () => readFileSync(file, "utf8");
const userSettings = {
  model: "opus",
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] },
};

describe("installHooks", () => {
  it("writes non-blocking http hooks with a short timeout and the real port", () => {
    installHooks(file, opts);
    const hooks = JSON.parse(read()).hooks as Record<string, { hooks: Record<string, unknown>[] }[]>;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    for (const groups of Object.values(hooks)) {
      const h = groups[0]!.hooks[0]!;
      expect(h).toMatchObject({ type: "http", url: "http://127.0.0.1:47821/hooks/claude-code", timeout: HOOK_TIMEOUT_S });
      expect(h.timeout as number).toBeLessThanOrEqual(5);
    }
    expect(JSON.stringify(hooks)).not.toContain('"command"');
  });

  it("is idempotent: a second run changes nothing", () => {
    writeFileSync(file, JSON.stringify(userSettings));
    expect(installHooks(file, opts)).toEqual({ changed: true, backedUp: true });
    const first = read();
    expect(installHooks(file, opts)).toEqual({ changed: false, backedUp: false });
    expect(read()).toBe(first);
  });

  it("keeps the user's own hooks and settings, and backs up the original once", () => {
    const original = JSON.stringify(userSettings);
    writeFileSync(file, original);
    installHooks(file, opts);
    const after = JSON.parse(read());
    expect(after.model).toBe("opus");
    expect(after.hooks.PreToolUse).toHaveLength(2);
    expect(readFileSync(backupPath(file), "utf8")).toBe(original);
    installHooks(file, { port: 5000, token: "other" }); // port change rewrites ours, backup stays original
    expect(readFileSync(backupPath(file), "utf8")).toBe(original);
    expect(read()).toContain(":5000/hooks/claude-code");
    expect(read()).not.toContain(":47821/");
  });

  it("refuses to touch invalid JSON", () => {
    writeFileSync(file, "{ nope");
    expect(() => installHooks(file, opts)).toThrow(/not valid JSON/);
    expect(read()).toBe("{ nope");
  });
});

describe("uninstallHooks", () => {
  it("restores the backup byte for byte", () => {
    const original = JSON.stringify(userSettings, null, 4);
    writeFileSync(file, original);
    installHooks(file, opts);
    expect(uninstallHooks(file).restoredBackup).toBe(true);
    expect(read()).toBe(original);
    expect(existsSync(backupPath(file))).toBe(false);
  });

  it("keeps later user edits and the backup when settings diverged", () => {
    writeFileSync(file, JSON.stringify(userSettings));
    installHooks(file, opts);
    const edited = { ...JSON.parse(read()), theme: "dark" };
    writeFileSync(file, JSON.stringify(edited));
    expect(uninstallHooks(file).restoredBackup).toBe(false);
    const after = JSON.parse(read());
    expect(after.theme).toBe("dark");
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(existsSync(backupPath(file))).toBe(true);
  });

  it("removes a settings file that init created from nothing", () => {
    installHooks(file, opts);
    uninstallHooks(file);
    expect(existsSync(file)).toBe(false);
  });

  it("does nothing when absent or never installed", () => {
    expect(uninstallHooks(file)).toEqual({ changed: false, restoredBackup: false });
    writeFileSync(file, JSON.stringify(userSettings));
    expect(uninstallHooks(file).changed).toBe(false);
  });
});

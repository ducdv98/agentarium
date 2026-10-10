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

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an array", [1]],
    ["a number", 3],
  ])("refuses a hooks container that is %s, naming the path, and leaves the file and backup untouched", (_, hooks) => {
    const original = JSON.stringify({ model: "opus", hooks });
    writeFileSync(file, original);
    expect(() => installHooks(file, opts)).toThrow(`${file}: hooks must be an object`);
    expect(read()).toBe(original);
    expect(existsSync(backupPath(file))).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an object", { matcher: "Bash" }],
  ])("refuses %s at an installed event before any write or backup", (_, value) => {
    const original = JSON.stringify({ hooks: { Stop: value } });
    writeFileSync(file, original);
    expect(() => installHooks(file, opts)).toThrow(/hooks\.Stop must be an array/);
    expect(read()).toBe(original);
    expect(existsSync(backupPath(file))).toBe(false);
  });

  it("keeps malformed group entries inside an installed event array and appends ours", () => {
    const junk = ["not a group", { matcher: "Bash" }];
    writeFileSync(file, JSON.stringify({ hooks: { Stop: junk } }));
    expect(installHooks(file, opts).changed).toBe(true);
    const stop = JSON.parse(read()).hooks.Stop;
    expect(stop.slice(0, 2)).toEqual(junk);
    expect(stop).toHaveLength(3);
  });

  it("preserves malformed values under unrelated events when init succeeds", () => {
    const junk = { matcher: "Bash", note: "not an array" };
    writeFileSync(file, JSON.stringify({ hooks: { Unrelated: junk, PreToolUse: [] } }));
    expect(installHooks(file, opts).changed).toBe(true);
    expect(JSON.parse(read()).hooks.Unrelated).toEqual(junk);
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

  it.each([
    ["an empty event array", { hooks: { PreToolUse: [] } }],
    ["an empty hooks object", { hooks: {} }],
    ["an empty group", { hooks: { Stop: [{ matcher: "", hooks: [] }] } }],
    ["junk under hooks", { hooks: { Stop: ["junk", 3, null], Odd: { x: 1 } } }],
  ])("leaves a never-installed file with %s unchanged byte for byte", (_, settings) => {
    const original = JSON.stringify(settings, null, 3);
    writeFileSync(file, original);
    expect(uninstallHooks(file)).toEqual({ changed: false, restoredBackup: false });
    expect(read()).toBe(original);
  });

  /** Simulates diverged settings (no matching backup) so uninstall takes the surgical path. */
  const installedWith = (extra: Record<string, unknown[]>) => {
    installHooks(file, opts);
    const installed = JSON.parse(read());
    for (const [event, groups] of Object.entries(extra)) {
      installed.hooks[event] = [...groups, ...(installed.hooks[event] ?? [])];
    }
    installed.theme = "dark";
    writeFileSync(file, JSON.stringify(installed));
  };

  it("keeps a user-authored empty event array the install never touched", () => {
    installedWith({});
    const settings = JSON.parse(read());
    settings.hooks.CustomEvent = [];
    writeFileSync(file, JSON.stringify(settings));
    uninstallHooks(file);
    expect(JSON.parse(read())).toEqual({ theme: "dark", hooks: { CustomEvent: [] } });
  });

  it("keeps a user-authored empty hooks object outside an emptied container", () => {
    writeFileSync(file, JSON.stringify({ theme: "dark", hooks: {} }));
    expect(uninstallHooks(file).changed).toBe(false);
    expect(JSON.parse(read())).toEqual({ theme: "dark", hooks: {} });
  });

  it("prunes groups, events and the hooks object only where removing ours emptied them", () => {
    installedWith({ Stop: [{ hooks: [] }] });
    uninstallHooks(file);
    expect(JSON.parse(read())).toEqual({ theme: "dark", hooks: { Stop: [{ hooks: [] }] } });
  });

  it.each([
    ["an empty event array", { hooks: { PreToolUse: [] } }],
    ["an empty hooks object", { hooks: {} }],
  ])("restores %s that existed before install", (_, settings) => {
    const original = JSON.stringify(settings);
    writeFileSync(file, original);
    installHooks(file, opts);
    expect(uninstallHooks(file).restoredBackup).toBe(true);
    expect(read()).toBe(original);
  });

  it("keeps pre-install empty containers when later edits prevent restoring the backup", () => {
    writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [] } }));
    installedWith({});
    uninstallHooks(file);
    expect(JSON.parse(read())).toEqual({ theme: "dark", hooks: { PreToolUse: [] } });
  });

  it("prunes the hooks object when removing ours empties every event", () => {
    installedWith({});
    uninstallHooks(file);
    expect(JSON.parse(read())).toEqual({ theme: "dark" });
  });

  it("keeps junk elements, matchers and extra fields when removing ours", () => {
    const ours = { type: "http", url: "http://127.0.0.1:47821/hooks/claude-code" };
    const mixed = { matcher: "Bash", note: "mine", hooks: [{ type: "command", command: "x" }, ours] };
    installedWith({ PreToolUse: ["junk", 7, null, { matcher: "Edit" }, mixed] });
    uninstallHooks(file);
    expect(JSON.parse(read()).hooks).toEqual({
      PreToolUse: [
        "junk",
        7,
        null,
        { matcher: "Edit" },
        { matcher: "Bash", note: "mine", hooks: [{ type: "command", command: "x" }] },
      ],
    });
  });
});

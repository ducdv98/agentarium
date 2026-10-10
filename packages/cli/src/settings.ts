import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";

/** Hook events we observe. SessionStart is absent: Claude Code runs only command hooks there. */
export const HOOK_EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "SessionEnd",
] as const;

/** Seconds. Short so a hung daemon cannot stall a session; failures are non-blocking anyway. */
export const HOOK_TIMEOUT_S = 2;

const OURS = /^http:\/\/127\.0\.0\.1:\d+\/hooks\/claude-code$/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isOurs = (h: unknown): boolean => isObj(h) && h.type === "http" && typeof h.url === "string" && OURS.test(h.url);

export const backupPath = (settingsPath: string): string => `${settingsPath}.agentarium-backup`;

/** Pure: removes our hook handlers, pruning groups and events that become empty. */
export function withoutHooks(settings: Json): Json {
  if (!isObj(settings.hooks)) return settings;
  const hooks: Json = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const kept = groups.flatMap((g: unknown) => {
      if (!isObj(g) || !Array.isArray(g.hooks)) return [g];
      const rest = g.hooks.filter((h: unknown) => !isOurs(h));
      if (rest.length === g.hooks.length) return [g];
      return rest.length ? [{ ...g, hooks: rest }] : [];
    });
    if (kept.length) hooks[event] = kept;
  }
  const { hooks: _drop, ...others } = settings;
  return Object.keys(hooks).length ? { ...others, hooks } : others;
}

/**
 * Returns the JSON path and reason when `hooks` holds a shape we must replace to install,
 * or null when installing can proceed. Unrelated events are never inspected.
 */
function hookShapeProblem(settings: Json): string | null {
  if (settings.hooks === undefined) return null;
  if (!isObj(settings.hooks)) return "hooks must be an object";
  for (const event of HOOK_EVENTS) {
    const groups = settings.hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) return `hooks.${event} must be an array of hook groups`;
  }
  return null;
}

/** Pure: our handlers replace any previous ones of ours. Applying twice equals applying once. */
export function withHooks(settings: Json, opts: { port: number; token: string }): Json {
  const problem = hookShapeProblem(settings);
  if (problem) throw new Error(problem);
  const clean = withoutHooks(settings);
  const hooks: Json = isObj(clean.hooks) ? { ...clean.hooks } : {};
  const handler = {
    type: "http",
    url: `http://127.0.0.1:${opts.port}/hooks/claude-code`,
    timeout: HOOK_TIMEOUT_S,
    headers: { Authorization: `Bearer ${opts.token}` },
  };
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, { hooks: [handler] }];
  }
  return { ...clean, hooks };
}

function readSettings(path: string): { settings: Json; raw: string | null } {
  if (!existsSync(path)) return { settings: {}, raw: null };
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return { settings: {}, raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON; refusing to modify it (${(err as Error).message})`);
  }
  if (!isObj(parsed)) throw new Error(`${path} is not a JSON object; refusing to modify it`);
  return { settings: parsed, raw };
}

const serialize = (settings: Json): string => `${JSON.stringify(settings, null, 2)}\n`;

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.agentarium-tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export interface InstallResult {
  changed: boolean;
  backedUp: boolean;
}

/** Idempotent. Backs up pre-existing settings once, before our first change. */
export function installHooks(settingsPath: string, opts: { port: number; token: string }): InstallResult {
  const { settings, raw } = readSettings(settingsPath);
  const problem = hookShapeProblem(settings);
  if (problem) throw new Error(`${settingsPath}: ${problem}; refusing to modify it`);
  const next = serialize(withHooks(settings, opts));
  if (next === raw) return { changed: false, backedUp: false };
  let backedUp = false;
  if (raw !== null && !existsSync(backupPath(settingsPath))) {
    copyFileSync(settingsPath, backupPath(settingsPath));
    backedUp = true;
  }
  writeAtomic(settingsPath, next);
  return { changed: true, backedUp };
}

export interface UninstallResult {
  changed: boolean;
  /** The backup was identical to the cleaned settings, so it was restored byte for byte. */
  restoredBackup: boolean;
}

/**
 * Removes only our handlers. If that leaves exactly what the backup holds, the backup is
 * restored verbatim; otherwise the user's later edits are kept and the backup is left in place.
 */
export function uninstallHooks(settingsPath: string): UninstallResult {
  const { settings, raw } = readSettings(settingsPath);
  if (raw === null) return { changed: false, restoredBackup: false };
  const cleaned = withoutHooks(settings);
  if (isDeepStrictEqual(cleaned, settings)) return { changed: false, restoredBackup: false };
  const backup = backupPath(settingsPath);
  if (existsSync(backup)) {
    try {
      if (isDeepStrictEqual(JSON.parse(readFileSync(backup, "utf8")), cleaned)) {
        copyFileSync(backup, settingsPath);
        rmSync(backup);
        return { changed: true, restoredBackup: true };
      }
    } catch {
      // unreadable backup: fall through to the surgical result
    }
  } else if (isDeepStrictEqual(cleaned, {})) {
    // We created the file ourselves (no backup was ever taken), so remove it.
    rmSync(settingsPath);
    return { changed: true, restoredBackup: false };
  }
  const next = serialize(cleaned);
  if (next === raw) return { changed: false, restoredBackup: false };
  writeAtomic(settingsPath, next);
  return { changed: true, restoredBackup: false };
}

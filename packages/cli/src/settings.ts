import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, fchmodSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

export const SETTINGS_WRITE_ATTEMPTS = 5;

interface WriteOptions {
  /** Test seam: inject a concurrent edit after preparation, before the final re-read. Attempts start at 1. */
  onPrepared?: (attempt: number) => void;
}

const OURS = /^http:\/\/127\.0\.0\.1:\d+\/hooks\/claude-code$/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isOurs = (h: unknown): boolean => isObj(h) && h.type === "http" && typeof h.url === "string" && OURS.test(h.url);

export const backupPath = (settingsPath: string): string => `${settingsPath}.agentarium-backup`;

/**
 * Pure: removes our hook handlers, pruning only the groups, events and hooks object that
 * those removals emptied. Containers the user left empty stay; with nothing of ours, returns the input.
 * `before` is the pre-install snapshot: an emptied container that existed there is kept, not pruned.
 */
export function withoutHooks(settings: Json, before: Json = {}): Json {
  if (!isObj(settings.hooks)) return settings;
  const hadHooks = isObj(before.hooks);
  const hadEvent = (event: string) => hadHooks && Array.isArray((before.hooks as Json)[event]);
  const hooks: Json = {};
  let changed = false;
  let prunedEvent = false;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    let prunedGroup = false;
    const kept = groups.flatMap((g: unknown) => {
      if (!isObj(g) || !Array.isArray(g.hooks)) return [g];
      const rest = g.hooks.filter((h: unknown) => !isOurs(h));
      if (rest.length === g.hooks.length) return [g];
      changed = true;
      if (!rest.length) prunedGroup = true;
      return rest.length ? [{ ...g, hooks: rest }] : [];
    });
    if (prunedGroup && !kept.length && !hadEvent(event)) prunedEvent = true;
    else hooks[event] = kept;
  }
  if (!changed) return settings;
  const { hooks: _drop, ...others } = settings;
  return prunedEvent && !hadHooks && !Object.keys(hooks).length ? others : { ...others, hooks };
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

function snapshot(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Permission bits, or null when absent. */
const modeOf = (path: string): number | null => {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat ? stat.mode & 0o777 : null;
};

function readSettings(path: string, bytes: Buffer | null): Json {
  const raw = bytes?.toString("utf8") ?? "";
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON; refusing to modify it (${(err as Error).message})`);
  }
  if (!isObj(parsed)) throw new Error(`${path} is not a JSON object; refusing to modify it`);
  return parsed;
}

const serialize = (settings: Json): string => `${JSON.stringify(settings, null, 2)}\n`;

type Commit = { kind: "write" | "restore"; content: Buffer; backup?: boolean } | { kind: "delete" };
type Plan<T> = { result: T; commit?: Commit };

/**
 * Compare-and-swap guard for every settings commit. Claude Code and editors do not lock:
 * a non-cooperating writer can still land a change between the final re-read and rename
 * (or delete) that we replace. The single re-read plus rename window only narrows the race.
 * Everything else, the backup included, is prepared before that re-read and undone if the attempt does not commit.
 */
function compareAndSwap<T>(path: string, plan: (raw: Buffer | null) => Plan<T>, opts: WriteOptions): T {
  for (let attempt = 1; attempt <= SETTINGS_WRITE_ATTEMPTS; attempt++) {
    const raw = snapshot(path);
    const mode = raw === null ? null : modeOf(path);
    // Existing settings keep their mode; new ones are owner-only. A file removed since the read falls back to private, and the re-read retries.
    const targetMode = mode ?? 0o600;
    const { result, commit } = plan(raw);
    if (!commit) return result;
    let tmp: string | undefined;
    let ownBackup = false; // A backup written by this attempt, dropped unless the attempt commits.
    let committed = false;
    try {
      if (commit.kind !== "delete") {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const candidate = `${path}.agentarium-${process.pid}-${randomBytes(16).toString("hex")}.tmp`;
        const fd = openSync(candidate, "wx", 0o600);
        tmp = candidate; // Only clean up a temp we successfully created ourselves.
        try {
          writeFileSync(fd, commit.content);
          fchmodSync(fd, targetMode);
        } finally {
          closeSync(fd);
        }
      }
      if (commit.kind === "write" && commit.backup && raw !== null) {
        const fd = openSync(backupPath(path), "wx", 0o600);
        ownBackup = true;
        try {
          writeFileSync(fd, raw);
          // Never wider than owner read/write or the settings file, regardless of umask.
          fchmodSync(fd, targetMode & 0o600);
        } finally {
          closeSync(fd);
        }
      }
      opts.onPrepared?.(attempt);
      const current = snapshot(path);
      if (raw === null ? current !== null : current === null || !raw.equals(current)) continue;
      if (modeOf(path) !== mode) continue; // A concurrent chmod (e.g. tightening) must not be undone by our rename.
      if (commit.kind === "delete") rmSync(path);
      else {
        renameSync(tmp!, path);
        if (commit.kind === "restore") rmSync(backupPath(path));
      }
      committed = true;
      return result;
    } finally {
      if (tmp) rmSync(tmp, { force: true });
      if (ownBackup && !committed) rmSync(backupPath(path), { force: true });
    }
  }
  throw new Error(`${path} kept changing while Agentarium was updating it; gave up after ${SETTINGS_WRITE_ATTEMPTS} attempts and left it as the other writer left it`);
}

export interface InstallResult {
  changed: boolean;
  backedUp: boolean;
}

/** Narrows a backup left by an earlier version to owner read/write at most. */
function protectBackup(settingsPath: string): void {
  const mode = modeOf(backupPath(settingsPath));
  if (mode !== null && mode & 0o177) chmodSync(backupPath(settingsPath), mode & 0o600);
}

/** Idempotent. Backs up pre-existing settings once, before our first change. */
export function installHooks(settingsPath: string, opts: { port: number; token: string }, writeOpts: WriteOptions = {}): InstallResult {
  protectBackup(settingsPath);
  return compareAndSwap<InstallResult>(settingsPath, (raw) => {
    const settings = readSettings(settingsPath, raw);
    const problem = hookShapeProblem(settings);
    if (problem) throw new Error(`${settingsPath}: ${problem}; refusing to modify it`);
    const next = Buffer.from(serialize(withHooks(settings, opts)));
    if (raw?.equals(next)) return { result: { changed: false, backedUp: false } };
    const backedUp = raw !== null && !existsSync(backupPath(settingsPath));
    return { result: { changed: true, backedUp }, commit: { kind: "write", content: next, backup: backedUp } };
  }, writeOpts);
}

/** The pre-install snapshot, or null when it is unreadable (uninstall then falls back to the surgical result). */
function readBackup(path: string): { settings: Json; raw: Buffer } | null {
  try {
    const raw = readFileSync(path);
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    return isObj(parsed) ? { settings: parsed, raw } : null;
  } catch {
    return null;
  }
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
export function uninstallHooks(settingsPath: string, writeOpts: WriteOptions = {}): UninstallResult {
  return compareAndSwap<UninstallResult>(settingsPath, (raw) => {
    const settings = readSettings(settingsPath, raw);
    const unchanged = { changed: false, restoredBackup: false };
    if (raw === null) return { result: unchanged };
    const backup = backupPath(settingsPath);
    const hasBackup = existsSync(backup);
    const before = hasBackup ? readBackup(backup) : null;
    const cleaned = withoutHooks(settings, before?.settings ?? {});
    if (isDeepStrictEqual(cleaned, settings)) return { result: unchanged };
    if (before && isDeepStrictEqual(before.settings, cleaned)) {
      return { result: { changed: true, restoredBackup: true }, commit: { kind: "restore", content: before.raw } };
    }
    if (!hasBackup && isDeepStrictEqual(cleaned, {})) {
      // We created the file ourselves (no backup was ever taken), so remove it.
      return { result: { changed: true, restoredBackup: false }, commit: { kind: "delete" } };
    }
    const next = Buffer.from(serialize(cleaned));
    if (raw.equals(next)) return { result: unchanged };
    return { result: { changed: true, restoredBackup: false }, commit: { kind: "write", content: next } };
  }, writeOpts);
}

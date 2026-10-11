import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { ActionCategory, AgentStatus } from "@agentarium/core";

export const GLITCH_KINDS = ["stale_client", "lost_but_alive", "late_session_start", "codex_live_dropped"] as const;
export type GlitchKind = (typeof GLITCH_KINDS)[number];

export interface Glitch {
  ts: number;
  kind: GlitchKind;
  room?: string;
  agent?: string;
  provider?: string;
  status?: AgentStatus;
  category?: ActionCategory | null;
  tool?: string | null;
  durationMs?: number;
  reason?: string;
}

export interface GlitchLog {
  record(glitch: Glitch): void;
  read(sinceTs: number): Promise<Glitch[]>;
  /** Resolves once every recorded Glitch is written. */
  flush(): Promise<void>;
}

export function memoryGlitchLog(): GlitchLog {
  const entries: Glitch[] = [];
  return {
    record(glitch) { entries.push({ ...glitch }); },
    async read(sinceTs) { return entries.filter((entry) => entry.ts >= sinceTs).map((entry) => ({ ...entry })); },
    async flush() {},
  };
}

const DEFAULT_RETENTION = 14 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const TRIM_INTERVAL = 24 * 60 * 60 * 1_000;

export function jsonlGlitchLog(file: string, opts: {
  clock?: () => number;
  retentionMs?: number;
  maxBytes?: number;
} = {}): GlitchLog {
  const clock = opts.clock ?? Date.now;
  const retentionMs = opts.retentionMs ?? DEFAULT_RETENTION;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let trimmedAt = clock();
  let queue: Promise<void> = prepare();

  function prepare(): Promise<void> {
    return trim().catch(() => undefined);
  }

  function enqueue(task: () => Promise<void>): void {
    queue = queue.then(task).catch(() => undefined);
  }

  async function trim(): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    trimmedAt = clock();
    const cutoff = trimmedAt - retentionMs;
    const entries = parse(text).filter((entry) => entry.ts >= cutoff);
    let lines = entries.map((entry) => `${JSON.stringify(entry)}\n`);
    while (lines.length && Buffer.byteLength(lines.join(""), "utf8") > maxBytes) lines.shift();
    await writeFile(file, lines.join(""), "utf8");
  }

  return {
    record(glitch) {
      enqueue(async () => {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify(glitch)}\n`, "utf8");
        let size = 0;
        try { size = (await stat(file)).size; } catch { return; }
        // A long-running Daemon also drops entries past retention once a day, not only when the file is full.
        if (size > maxBytes || clock() - trimmedAt >= TRIM_INTERVAL) await trim();
      });
    },
    async read(sinceTs) {
      await queue;
      return readGlitchFile(file, sinceTs);
    },
    async flush() {
      await queue;
    },
  };
}

/** Reads the file without trimming it, so a reader never rewrites a file the Daemon is appending to. */
export async function readGlitchFile(file: string, sinceTs: number): Promise<Glitch[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return parse(text).filter((entry) => entry.ts >= sinceTs);
}

/** The file is hand-editable, so a line is checked before formatting trusts its fields. */
function isGlitch(value: unknown): value is Glitch {
  if (!value || typeof value !== "object") return false;
  const g = value as Record<string, unknown>;
  const optional = (key: string, type: string) => g[key] === undefined || typeof g[key] === type;
  return typeof g.ts === "number" && Number.isFinite(g.ts)
    && (GLITCH_KINDS as readonly unknown[]).includes(g.kind)
    && optional("room", "string") && optional("agent", "string") && optional("provider", "string")
    && optional("durationMs", "number") && optional("reason", "string");
}

function parse(text: string): Glitch[] {
  const entries: Glitch[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Glitch;
      if (isGlitch(value)) entries.push(value);
    } catch {
      // A partial write must not hide the rest of the log.
    }
  }
  return entries;
}

const pad = (n: number): string => String(n).padStart(2, "0");

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "?";
  const seconds = Math.round(ms / 1_000);
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

/** One usage-log bullet; the user fills in what was true and whether it hurt triage. */
export function formatGlitch(glitch: Glitch): string {
  const date = new Date(glitch.ts);
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const room = glitch.room ? basename(glitch.room.replaceAll("\\", "/")) : "an unknown Room";
  // Agent keys are machine:provider:session:agent; the session prefix is what a user can match.
  const session = glitch.agent?.split(":").at(-2)?.slice(0, 8) ?? "?";
  const agent = `Agent ${glitch.provider ?? "?"}:${session}`;
  const duration = formatDuration(glitch.durationMs);
  let sentence: string;
  switch (glitch.kind) {
    case "stale_client":
      sentence = `a client of ${room} was stale for ${duration} while an Agent needed the user`;
      break;
    case "lost_but_alive":
      sentence = `${agent} in ${room} was marked lost, then sent an event after ${duration} of silence`;
      break;
    case "late_session_start":
      sentence = `${agent} in ${room} first appeared with ${glitch.reason ?? "an event"} instead of session_start`;
      break;
    case "codex_live_dropped":
      sentence = `Codex live became unavailable${glitch.reason ? ` (${glitch.reason})` : ""}`;
      break;
  }
  return `- ${stamp} Glitch: ${sentence}. What was true: ?. Hurt triage: ?`;
}

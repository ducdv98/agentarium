import { openSync, readSync, closeSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { readTailLines } from "./tail";

export interface CodexSessionMeta {
  threadId: string;
  sessionId: string;
  parentThreadId: string | null;
  cwd: string;
  cliVersion: string;
}

/** The path arrives in a hook payload: only a rollout file is read, and only a bounded tail of it. */
export function readCodexApprovalsReviewer(path: string): string | null {
  if (!/^rollout-[\w.-]+\.jsonl$/.test(basename(path))) return null;
  let reviewer: string | null = null;
  for (const line of readTailLines(path)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.type === "turn_context" && value.payload && typeof value.payload === "object") {
        const candidate = (value.payload as Record<string, unknown>).approvals_reviewer;
        reviewer = typeof candidate === "string" ? candidate : null;
      }
    } catch { /* Ignore malformed or partial rollout lines. */ }
  }
  return reviewer;
}

/** Rollouts may contain prompts; only the bounded first line is read. */
export function readCodexSessionMeta(path: string): CodexSessionMeta | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(256 * 1024);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, count).indexOf(10);
    if (newline < 0 && count === buffer.length) return null;
    const first = JSON.parse(buffer.toString("utf8", 0, newline < 0 ? count : newline)) as Record<string, unknown>;
    if (first.type !== "session_meta" || !first.payload || typeof first.payload !== "object") return null;
    const p = first.payload as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.session_id !== "string" ||
      (p.parent_thread_id !== null && typeof p.parent_thread_id !== "string") ||
      typeof p.cwd !== "string" || typeof p.cli_version !== "string") return null;
    return { threadId: p.id, sessionId: p.session_id, parentThreadId: p.parent_thread_id,
      cwd: p.cwd, cliVersion: p.cli_version };
  } catch { return null; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* Reader never throws. */ } }
}

export function findCodexRollout(codexHome: string, threadId: string): CodexSessionMeta | null {
  if (!/^[\w-]+$/.test(threadId)) return null;
  try {
    const sessions = join(codexHome, "sessions");
    const dates: string[] = [];
    let years: string[] = [];
    try { years = readdirSync(sessions).sort().reverse(); } catch { /* Archived rollouts may still exist. */ }
    for (const year of years) {
      if (!/^\d{4}$/.test(year)) continue;
      let months: string[];
      try { months = readdirSync(join(sessions, year)).sort().reverse(); } catch { continue; }
      for (const month of months) {
        if (!/^\d{2}$/.test(month)) continue;
        let days: string[];
        try { days = readdirSync(join(sessions, year, month)).sort().reverse(); } catch { continue; }
        for (const day of days) {
          if (/^\d{2}$/.test(day)) dates.push(join(sessions, year, month, day));
          if (dates.length >= 14) break;
        }
        if (dates.length >= 14) break;
      }
      if (dates.length >= 14) break;
    }
    for (const dir of [...dates, join(codexHome, "archived_sessions")]) {
      let names: string[];
      try { names = readdirSync(dir).sort().reverse(); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith(`-${threadId}.jsonl`) || basename(name) !== name) continue;
        const meta = readCodexSessionMeta(join(dir, name));
        if (meta?.threadId === threadId) return meta;
      }
    }
  } catch { /* Missing or malformed directory tree. */ }
  return null;
}

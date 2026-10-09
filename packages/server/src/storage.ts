import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "@agentarium/core";

/** Append-only per-room event log. Swappable (e.g. for SQLite later). */
export interface EventLog {
  append(room: string, event: AgentEvent): Promise<void>;
  read(room: string): Promise<AgentEvent[]>;
  rooms(): Promise<string[]>;
}

export function memoryLog(): EventLog {
  const logs = new Map<string, AgentEvent[]>();
  return {
    async append(room, event) {
      logs.set(room, [...(logs.get(room) ?? []), event]);
    },
    async read(room) {
      return [...(logs.get(room) ?? [])];
    },
    async rooms() {
      return [...logs.keys()];
    },
  };
}

const EXT = ".jsonl";
const fileFor = (room: string): string => `${encodeURIComponent(room).replaceAll("_", "%5F").replaceAll("%", "_")}${EXT}`;
const roomFor = (file: string): string =>
  decodeURIComponent(file.slice(0, -EXT.length).replaceAll("_", "%"));

/** One JSON-lines file per room. Room ids are encoded so `_` cannot collide with `%`. */
export function jsonlLog(dir: string): EventLog {
  const ready = mkdir(dir, { recursive: true });
  return {
    async append(room, event) {
      await ready;
      await appendFile(join(dir, fileFor(room)), `${JSON.stringify(event)}\n`, "utf8");
    },
    async read(room) {
      await ready;
      let text: string;
      try {
        text = await readFile(join(dir, fileFor(room)), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const events: AgentEvent[] = [];
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as AgentEvent);
        } catch {
          // A torn line (crash mid-append) is skipped; the rest of the log stays usable.
        }
      }
      return events;
    },
    async rooms() {
      await ready;
      return (await readdir(dir)).filter((f) => f.endsWith(EXT)).map(roomFor);
    },
  };
}

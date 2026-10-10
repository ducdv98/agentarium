import { isObj } from "./shared";

const MAX_OPEN_CALLS = 100;

interface OpenCall {
  id: string;
  tool: string;
  input: unknown;
  prompted: boolean;
}

/** True when every field of the call's input appears unchanged in the prompt's (Codex adds a `description`). */
const sameInput = (call: unknown, prompt: unknown): boolean =>
  !isObj(call) || (isObj(prompt) && Object.entries(call).every(([k, v]) => JSON.stringify(v) === JSON.stringify(prompt[k])));

/**
 * Tracks which open tool call each permission prompt belongs to. A permission hook carries no
 * `tool_use_id` and a denial has no closing hook, so a prompted call that is still open when the
 * agent's turn ends was denied or aborted: `close` returns those ids so they become failed outcomes.
 */
export function createPermissionPrompts() {
  const open = new Map<string, OpenCall[]>();
  const key = (session: string, agent: string) => `${session}\0${agent}`;
  return {
    started(session: string, agent: string, id: string, tool: string, input: unknown): void {
      const calls = open.get(key(session, agent)) ?? [];
      calls.push({ id, tool, input, prompted: false });
      if (calls.length > MAX_OPEN_CALLS) calls.shift();
      open.set(key(session, agent), calls);
    },
    ended(session: string, agent: string, id: string): void {
      const calls = open.get(key(session, agent));
      const i = calls?.findIndex((c) => c.id === id) ?? -1;
      if (i >= 0) calls!.splice(i, 1);
    },
    /** Marks the latest open call the prompt matches, preferring one whose input matches too; returns its id. */
    prompted(session: string, agent: string, tool: string | undefined, input: unknown): string | undefined {
      const calls = (open.get(key(session, agent)) ?? []).filter((c) => !c.prompted && c.tool === tool);
      const call = calls.filter((c) => sameInput(c.input, input)).at(-1) ?? calls.at(-1);
      if (call) call.prompted = true;
      return call?.id;
    },
    isPrompted(session: string, agent: string, id: string): boolean {
      return open.get(key(session, agent))?.some((c) => c.id === id && c.prompted) ?? false;
    },
    /** The user rejected the prompt outside any hook: forgets the call; false when it was not open. */
    reject(session: string, agent: string, id: string): boolean {
      const calls = open.get(key(session, agent));
      const i = calls?.findIndex((c) => c.id === id && c.prompted) ?? -1;
      if (i >= 0) calls!.splice(i, 1);
      return i >= 0;
    },
    /** The agent's turn is over: forgets its open calls and returns the prompted ones that never finished. */
    close(session: string, agent: string): string[] {
      const calls = open.get(key(session, agent)) ?? [];
      open.delete(key(session, agent));
      return calls.filter((c) => c.prompted).map((c) => c.id);
    },
    forgetSession(session: string): void {
      for (const k of open.keys()) if (k.startsWith(`${session}\0`)) open.delete(k);
    },
  };
}

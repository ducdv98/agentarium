import type { ActionCategory } from "@agentarium/core";

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const text = (v: unknown): string | undefined => typeof v === "string" && v.length > 0 ? v : undefined;
export const clip = (s: string): string => {
  const line = (s.split(/\r?\n/, 1)[0] ?? "").trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};
export const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;

/** MCP tools act on the outside world, so an unrecognised verb defaults to exec. */
export const categoryForMcpTool = (tool: string): ActionCategory => {
  const name = tool.split("__").at(-1) ?? tool;
  const verb = name.toLowerCase().split(/[_-]/)[0] ?? "";
  if (["read", "get", "list", "view", "show"].includes(verb)) return "read";
  if (["search", "find", "query", "grep", "lookup"].includes(verb)) return "search";
  const writeVerbs = [
    "write", "create", "update", "edit", "delete", "remove", "set", "add", "save", "post", "put", "send", "move", "rename",
  ];
  if (writeVerbs.includes(verb)) return "write";
  if (["navigate", "fetch", "browse", "request", "http", "download", "upload"].includes(verb)) return "network";
  return "exec";
};

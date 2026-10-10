import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_CATEGORIES, AGENT_STATES, type AgentState } from "@agentarium/core";
import { dotGrid, layoutWorld, resolveAgent, validateTheme, type Theme } from "../src";

const agent = (over: Partial<AgentState> = {}): AgentState => ({
  key: "k",
  ref: { machine: "m", provider: "p", session: "s", agent: "a" },
  parent: null,
  parentProvenance: null,
  status: "working",
  category: null,
  tool: null,
  summary: null,
  permissionMode: null,
  pending: {},
  firstTs: 0,
  lastTs: 0,
  ...over,
});

/** A theme that only supplies the mandatory fallbacks. */
const bare: Theme = {
  ...dotGrid,
  id: "bare",
  states: {},
  stations: {},
};

describe("theme manifest", () => {
  it("dot-grid is valid", () => {
    expect(validateTheme(dotGrid)).toEqual([]);
  });

  it("flags unknown categories, unknown states and bad stations", () => {
    const broken = {
      ...dotGrid,
      stations: { ...dotGrid.stations, harvest: { id: "x", label: "x", capacity: 1 }, read: { id: "", label: "r", capacity: 0 } },
      states: { ...dotGrid.states, sleeping: { color: "#000", animation: "none" } },
    } as unknown as Theme;
    expect(validateTheme(broken)).toHaveLength(3);
  });

  it("every state x action category resolves in dot-grid", () => {
    for (const status of AGENT_STATES) {
      for (const category of [...ACTION_CATEGORIES, null]) {
        const r = resolveAgent(dotGrid, agent({ status, category }), false);
        expect(r.station.id).toBeTruthy();
        expect(r.style.color).toMatch(/^#/);
      }
    }
  });

  it("every state x action category falls back when the theme defines nothing", () => {
    for (const status of AGENT_STATES) {
      for (const category of ACTION_CATEGORIES) {
        const r = resolveAgent(bare, agent({ status, category }), false);
        expect(r.station).toEqual(bare.fallback.station);
        expect(r.style).toEqual(bare.fallback.state);
      }
      expect(resolveAgent(bare, agent({ status, category: null }), false).station).toEqual(bare.rest);
    }
  });

  it("carries the needs-input flag through", () => {
    expect(resolveAgent(dotGrid, agent({ status: "waiting", category: "wait" }), true).needsInput).toBe(true);
  });
});

describe("layoutWorld", () => {
  const world = { agents: {}, now: 0 };

  it("groups agents into one lane per station and wraps at capacity", () => {
    const theme: Theme = { ...dotGrid, stations: { ...dotGrid.stations, read: { id: "read", label: "read", capacity: 2 } } };
    const agents = [0, 1, 2].map((i) => agent({ key: `a${i}`, category: "read", firstTs: i }));
    const l = layoutWorld(theme, world, agents);
    expect(l.lanes).toEqual([{ id: "read", label: "read", col: 0, cols: 2 }]);
    expect(l.dots.map((d) => [d.col, d.row])).toEqual([[0, 0], [0, 1], [1, 0]]);
  });

  it("separates lanes by an empty column", () => {
    const l = layoutWorld(dotGrid, world, [
      agent({ key: "a", category: "read", firstTs: 1 }),
      agent({ key: "b", category: "exec", firstTs: 2 }),
    ]);
    expect(l.lanes.map((x) => x.col)).toEqual([0, 2]);
  });
});

describe("core stays theme-neutral", () => {
  it("uses no scene words in core, adapters or server sources", () => {
    const banned = /\b(office|desk|farm|farmhand|tractor|bookshelf|department|manager|foreman|construction)\b/i;
    const root = join(__dirname, "../../");
    for (const pkg of ["core", "adapters", "server"]) {
      const dir = join(root, pkg, "src");
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
        const text = readFileSync(join(dir, f), "utf8");
        expect(text.match(banned)?.[0], `${pkg}/src/${f}`).toBeUndefined();
      }
    }
  });
});

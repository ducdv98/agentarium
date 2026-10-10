import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_CATEGORIES, AGENT_STATES, type AgentState } from "@agentarium/core";
import {
  dotGrid,
  DIRECTIONS,
  layoutWorld,
  resolveAgent,
  resolveAnimation,
  validateTheme,
  type Theme,
} from "../src";
import { completeTheme } from "./fixtures/theme";

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

  it("accepts a complete 2d manifest in strict mode", () => {
    expect(validateTheme(completeTheme, { strict: true })).toEqual([]);
  });

  it("lists strict completeness gaps", () => {
    const incomplete = {
      ...completeTheme,
      stations: { ...completeTheme.stations, read: undefined },
      renderers: {
        "2d": {
          ...completeTheme.renderers?.["2d"],
          atlases: [],
          walk: { ne: "walk/ne" },
          states: { idle: { ne: "idle/ne" } },
          categories: { read: { ne: "read/ne" } },
        },
      },
    } as unknown as Theme;
    expect(validateTheme(incomplete, { strict: true })).toEqual([
      "stations.read: missing",
      "renderers.2d.atlases: empty",
      "renderers.2d.walk.nw: missing",
      "renderers.2d.walk.se: missing",
      "renderers.2d.walk.sw: missing",
      "renderers.2d.states.idle.nw: missing",
      "renderers.2d.states.idle.se: missing",
      "renderers.2d.states.idle.sw: missing",
      "renderers.2d.states.waiting: missing",
      "renderers.2d.states.blocked: missing",
      "renderers.2d.categories.read.nw: missing",
      "renderers.2d.categories.read.se: missing",
      "renderers.2d.categories.read.sw: missing",
      "renderers.2d.categories.write: missing",
      "renderers.2d.categories.exec: missing",
      "renderers.2d.categories.search: missing",
      "renderers.2d.categories.network: missing",
      "renderers.2d.categories.delegate: missing",
      "renderers.2d.categories.think: missing",
      "renderers.2d.categories.wait: missing",
      "renderers.2d.categories.error: missing",
    ]);
  });

  it("requires 2d only in strict mode", () => {
    expect(validateTheme(dotGrid, { strict: true })).toEqual(["renderers.2d: missing"]);
    expect(validateTheme(dotGrid)).toEqual([]);
  });

  it("resolves every animated state and category", () => {
    for (const status of AGENT_STATES) {
      for (const category of [...ACTION_CATEGORIES, null]) {
        for (const direction of DIRECTIONS) {
          for (const moving of [false, true]) {
            const result = resolveAnimation(completeTheme, { status, category }, direction, moving);
            if (status === "lost" || status === "done") expect(result).toBeNull();
            else expect(result).toEqual(expect.any(String));
          }
        }
      }
    }
  });

  it("falls back by direction and to idle", () => {
    const theme = {
      ...completeTheme,
      renderers: {
        "2d": {
          ...completeTheme.renderers?.["2d"],
          walk: { ne: "walk/ne" },
          states: { idle: { sw: "idle/sw" } },
          categories: {},
        },
      },
    } as unknown as Theme;
    expect(resolveAnimation(theme, { status: "working", category: "read" }, "nw", true)).toBe("walk/ne");
    expect(resolveAnimation(theme, { status: "working", category: "read" }, "ne", false)).toBe("idle/sw");
    expect(resolveAnimation(theme, { status: "blocked", category: null }, "se", false)).toBe("idle/sw");
    const waitOnly = { ...completeTheme, renderers: { "2d": { atlases: [], states: {}, categories: { wait: { se: "wait/se" } } } } };
    expect(resolveAnimation(waitOnly, { status: "waiting", category: "wait" }, "ne", false)).toBe("wait/se");
    expect(resolveAnimation(bare, { status: "idle", category: null }, "ne", false)).toBeNull();
    expect(() => resolveAnimation({} as Theme, { status: "idle", category: null }, "ne", false)).not.toThrow();
  });

  it("flags malformed renderer fields without throwing", () => {
    const broken = {
      ...dotGrid,
      renderers: {
        "2d": { atlases: [""], walk: "walk", states: { strange: { xx: "" } }, categories: { read: { ne: 42 } } },
      },
    } as unknown as Theme;
    expect(validateTheme(broken)).toEqual([
      "renderers.2d.atlases.0: needs a path",
      "renderers.2d.walk: not a clip",
      "renderers.2d.states.strange: not an animated state",
      "renderers.2d.states.strange.xx: not a direction",
      "renderers.2d.states.strange.xx: needs an animation name",
      "renderers.2d.categories.read.ne: needs an animation name",
    ]);
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

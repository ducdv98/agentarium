import { describe, expect, it } from "vitest";
import { dotGrid, type Renderer, type Theme } from "../src";
import { agent, world } from "./fixtures/world";

const sorted = (r: Renderer) => r.markers().map((m) => m.key).sort();

/**
 * The needs-input marker contract every Renderer must meet (phase-3-scene 05): the renderer draws its own
 * marker over each agent with the Needs-input flag, in `palette.alert`, whatever the theme does with the agent.
 * Run it for each renderer with `describeRendererContract(name, create)`. No DOM: markers follow state alone.
 */
export function describeRendererContract(name: string, create: (theme: Theme) => Renderer): void {
  describe(`${name}: needs-input marker contract`, () => {
    const make = (theme: Theme = dotGrid): Renderer => {
      const r = create(theme);
      r.setTheme(theme);
      return r;
    };

    it("marks an agent waiting on the user, in the theme's alert colour", () => {
      const r = make();
      r.applyState({ kind: "snapshot", world: world(agent("a", { status: "waiting", category: "wait" }), agent("b")) });
      expect(r.markers()).toEqual([{ key: "a", color: dotGrid.palette.alert }]);
    });

    it("marks every ancestor of a waiting agent, up to the lead", () => {
      const r = make();
      r.applyState({
        kind: "snapshot",
        world: world(
          agent("lead"),
          agent("mid", { parent: "lead" }),
          agent("leaf", { parent: "mid", status: "waiting" }),
          agent("sibling", { parent: "lead" }),
          agent("other"),
        ),
      });
      expect(sorted(r)).toEqual(["lead", "leaf", "mid"]);
    });

    it("draws no marker when nobody needs the user, and none for lost or done agents", () => {
      const r = make();
      r.applyState({
        kind: "snapshot",
        world: world(agent("a"), agent("b", { status: "idle" }), agent("c", { status: "done" }), agent("d", { status: "lost" })),
      });
      expect(r.markers()).toEqual([]);
    });

    it("follows patches: the marker appears and clears with the flag", () => {
      const r = make();
      r.applyState({ kind: "snapshot", world: world(agent("a")) });
      r.applyState({ kind: "patch", patch: { upserts: [agent("a", { status: "waiting" })], removed: [], now: 1 } });
      expect(sorted(r)).toEqual(["a"]);
      r.applyState({ kind: "patch", patch: { upserts: [agent("a")], removed: [], now: 2 } });
      expect(r.markers()).toEqual([]);
    });

    const styled: [string, Theme][] = [
      ["no waiting style", { ...dotGrid, states: { ...dotGrid.states, waiting: undefined } }],
      ["no states at all", { ...dotGrid, states: {} }],
      ["a faded waiting style", { ...dotGrid, states: { ...dotGrid.states, waiting: { color: "#000", animation: "fade" } } }],
      ["a waiting style in the alert colour", { ...dotGrid, states: { waiting: { color: dotGrid.palette.alert, animation: "blink" } } }],
      ["no stations", { ...dotGrid, stations: {} }],
    ];
    for (const [label, theme] of styled) {
      it(`keeps the marker with ${label}`, () => {
        const r = make(theme);
        r.applyState({ kind: "snapshot", world: world(agent("a", { status: "waiting", category: "wait" })) });
        expect(r.markers()).toEqual([{ key: "a", color: theme.palette.alert }]);
      });
    }

    it("takes the colour from the current theme, and still draws one when the theme has no alert colour", () => {
      const r = make();
      r.applyState({ kind: "snapshot", world: world(agent("a", { status: "waiting" })) });
      r.setTheme({ ...dotGrid, palette: { ...dotGrid.palette, alert: "#123456" } });
      expect(r.markers()).toEqual([{ key: "a", color: "#123456" }]);
      r.setTheme({ ...dotGrid, palette: { ...dotGrid.palette, alert: "" } });
      const [marker] = r.markers();
      expect(marker?.key).toBe("a");
      expect(marker?.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
}

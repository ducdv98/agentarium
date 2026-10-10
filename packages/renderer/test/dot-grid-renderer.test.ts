import { afterEach, describe, expect, it, vi } from "vitest";
import { createDotGridRenderer, dotGrid, type Theme } from "../src";
import { agent, world } from "./fixtures/world";
import { describeRendererContract } from "./renderer-contract";

describeRendererContract("dot grid", (theme) => createDotGridRenderer(theme));

interface Call {
  op: string;
  alpha: number;
  stroke: unknown;
  fill: unknown;
}

/** A recording 2D context plus the globals the renderer touches when mounted. */
function fakeCanvas() {
  const calls: Call[] = [];
  const state: Record<string | symbol, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get: (target, prop) =>
      prop in target
        ? target[prop]
        : (..._args: unknown[]) =>
            void calls.push({ op: String(prop), alpha: target.globalAlpha as number, stroke: target.strokeStyle, fill: target.fillStyle }),
    set: (target, prop, value) => ((target[prop] = value), true),
  });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", {
    createElement: () => ({ style: {}, width: 0, height: 0, getContext: () => ctx, remove() {} }),
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const host = { clientWidth: 400, clientHeight: 300, appendChild() {} } as unknown as HTMLElement;
  const drawFrame = (): void => frames.splice(0).forEach((cb) => cb(1000));
  return { calls, host, drawFrame };
}

describe("dot grid renderer drawing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("strokes the marker fully opaque in the alert colour, over every dot, whatever the waiting style", () => {
    const faded: Theme = { ...dotGrid, states: { ...dotGrid.states, waiting: { color: "#000000", animation: "fade" } } };
    const { calls, host, drawFrame } = fakeCanvas();
    const r = createDotGridRenderer(faded);
    r.mount(host);
    r.applyState({
      kind: "snapshot",
      world: world(agent("lead"), agent("leaf", { parent: "lead", status: "waiting", category: "wait" }), agent("z")),
    });
    drawFrame();

    const rings = calls.filter((c) => c.op === "stroke" && c.stroke === faded.palette.alert);
    expect(rings).toHaveLength(2);
    expect(rings.every((c) => c.alpha === 1)).toBe(true);
    const lastFill = calls.map((c) => c.op).lastIndexOf("fill");
    expect(calls.indexOf(rings[0]!)).toBeGreaterThan(lastFill);
    r.dispose();
  });
});

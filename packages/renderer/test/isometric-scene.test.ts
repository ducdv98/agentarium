import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRoom, placeholderRoom } from "../src/isometric/room";
import { createIsoScene, FADE_MS, SHIRT_COLOURS, WALK_TILES_PER_SECOND, type IsoScene } from "../src/isometric/scene";
import type { RoomLayout, SceneAgent } from "../src/isometric/types";
import { resolveAnimation } from "../src/theme";
import { dotGrid } from "../src/themes/dot-grid";
import { completeTheme } from "./fixtures/theme";
import { agent, world } from "./fixtures/world";

const officeJson: unknown = JSON.parse(readFileSync(join(__dirname, "../../../assets/src/scenes/office-room/layout.json"), "utf8"));

function smallRoom(): RoomLayout {
  return {
    size: [4, 3],
    floor: { legend: { ".": "floor" }, rows: ["....", "....", "...."] },
    stations: {
      exec: { label: "Exec", slots: [{ at: [0, 0], facing: "sw" }] },
      read: { label: "Read", slots: [{ at: [2, 1], facing: "ne" }] },
      rest: { label: "Rest", slots: [{ at: [0, 2], facing: "nw" }] },
    },
  };
}

function shown(scene: IsoScene, now: number, key = "a"): SceneAgent {
  const result = scene.frame(now).agents.find((a) => a.key === key);
  if (!result) throw new Error(`Missing scene agent ${key}`);
  return result;
}

function walkingScene(): IsoScene {
  const scene = createIsoScene(completeTheme, smallRoom());
  scene.apply(world(agent("a")), 0);
  scene.apply(world(agent("a", { category: "read" })), 1000);
  return scene;
}

describe("scene places", () => {
  it("takes the first free slots in firstTs/key order", () => {
    const room = smallRoom();
    room.stations.exec!.slots.push({ at: [1, 0], facing: "se" }, { at: [2, 0], facing: "ne" });
    const scene = createIsoScene(dotGrid, room);
    scene.apply(world(agent("c", { firstTs: 2 }), agent("b"), agent("a")), 0);
    const frame = scene.frame(0);
    expect(frame.agents.map((a) => a.key)).toEqual(["a", "b", "c"]);
    expect(frame.agents.map((a) => [a.column, a.row, a.direction])).toEqual([
      [0, 0, "sw"], [1, 0, "se"], [2, 0, "ne"],
    ]);
    expect(frame.changing).toBe(false);
  });

  it("keeps a place when another agent leaves, and immediately reuses the freed slot", () => {
    const room = smallRoom();
    room.stations.exec!.slots.push({ at: [1, 0], facing: "sw" });
    const scene = createIsoScene(dotGrid, room);
    scene.apply(world(agent("a"), agent("b")), 0);
    scene.apply(world(agent("b"), agent("c")), 100);
    expect(shown(scene, 100, "b")).toMatchObject({ column: 1, row: 0, moving: false });
    expect(shown(scene, 100, "c")).toMatchObject({ column: 0, row: 0, alpha: 0 });
    expect(shown(scene, 600, "a").alpha).toBe(0.5);
    scene.apply(world(agent("b"), agent("c")), 700);
    expect(shown(scene, 700, "b")).toMatchObject({ column: 1, row: 0, moving: false });
  });

  it("releases every changed station before assigning any new places", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("a"), agent("b", { category: "read" })), 0);
    scene.apply(world(agent("a", { category: "read" }), agent("b")), 100);
    expect(shown(scene, 1600, "a")).toMatchObject({ column: 2, row: 1 });
    expect(shown(scene, 1600, "b")).toMatchObject({ column: 0, row: 0 });
  });

  it("rests idle agents and categories absent from the room", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("a", { status: "idle", category: null })), 0);
    expect(shown(scene, 0)).toMatchObject({ column: 0, row: 2, direction: "nw" });
    scene.apply(world(agent("a", { category: "write" })), 100);
    expect(shown(scene, 100)).toMatchObject({ column: 0, row: 2, moving: false });
  });

  it("overflows to the nearest free walkable non-slot tile and inherits its source facing", () => {
    const room: RoomLayout = {
      size: [3, 2],
      floor: { legend: { ".": "floor" }, rows: ["...", "..."] },
      stations: {
        exec: { label: "Exec", slots: [{ at: [0, 0], facing: "sw" }, { at: [2, 0], facing: "ne" }] },
        rest: { label: "Rest", slots: [{ at: [1, 0], facing: "nw" }] },
      },
    };
    const scene = createIsoScene(dotGrid, room);
    scene.apply(world(agent("a"), agent("b"), agent("c")), 0);
    expect(shown(scene, 0, "c")).toMatchObject({ column: 0, row: 1, direction: "sw" });
    room.props = [{ part: "desk", at: [0, 1], facing: "sw" }];
    const blocked = createIsoScene(dotGrid, room);
    blocked.apply(world(agent("a"), agent("b"), agent("c")), 0);
    expect(shown(blocked, 0, "c")).toMatchObject({ column: 2, row: 1, direction: "ne" });
  });

  it("uses partition-aware BFS for overflow", () => {
    const room = smallRoom();
    room.partitions = [{ part: "glass", at: [1, 0], facing: "se" }];
    const scene = createIsoScene(dotGrid, room);
    scene.apply(world(agent("a"), agent("b")), 0);
    expect(shown(scene, 0, "b")).toMatchObject({ column: 0, row: 1, direction: "sw" });
  });

  it("keeps overflow places sticky even when a station slot becomes free", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("a"), agent("b")), 0);
    const before = shown(scene, 0, "b");
    scene.apply(world(agent("b")), 100);
    expect(shown(scene, 100, "b")).toMatchObject({ column: before.column, row: before.row, moving: false });
  });

  it("shares the least occupied slot with deterministic offsets when the room is full", () => {
    const room: RoomLayout = {
      size: [3, 1],
      floor: { legend: { ".": "floor" }, rows: ["..."] },
      stations: {
        exec: { label: "Exec", slots: [{ at: [0, 0], facing: "sw" }, { at: [1, 0], facing: "se" }] },
        rest: { label: "Rest", slots: [{ at: [2, 0], facing: "nw" }] },
      },
    };
    const scene = createIsoScene(dotGrid, room);
    scene.apply(world(...["a", "b", "c", "d", "e"].map((key) => agent(key))), 0);
    const agents = scene.frame(0).agents;
    expect(agents.map((a) => a.column)).toEqual([0, 1, 0, 1, 0]);
    expect(agents[0]?.offset).toEqual({ x: 0, y: 0 });
    expect(agents[1]?.offset).toEqual({ x: 0, y: 0 });
    expect(agents[2]?.offset).toEqual(agents[3]?.offset);
    expect(agents[2]?.offset.x).toBeCloseTo(Math.cos(2.4) * 12);
    expect(agents[2]?.offset.y).toBeCloseTo(Math.sin(2.4) * 6);
    expect(agents[4]?.offset).not.toEqual(agents[2]?.offset);
  });

  it("places 200 agents in the real office room", () => {
    const room = parseRoom(officeJson).room!;
    const scene = createIsoScene(completeTheme, room);
    scene.apply(world(...Array.from({ length: 200 }, (_, i) => agent(`agent-${i}`, { category: "delegate", firstTs: i }))), 0);
    const frame = scene.frame(0);
    expect(frame.agents).toHaveLength(200);
    expect(frame.changing).toBe(false);
    for (const agent of frame.agents) {
      expect(Number.isFinite(agent.column)).toBe(true);
      expect(agent.column).toBeGreaterThanOrEqual(0);
      expect(agent.column).toBeLessThan(room.size[0]);
      expect(agent.row).toBeGreaterThanOrEqual(0);
      expect(agent.row).toBeLessThan(room.size[1]);
    }
    expect(frame.agents.some((a) => a.offset.x !== 0)).toBe(true);
  });
});

describe("scene walking", () => {
  it("interpolates at two tiles per second, faces each step, and faces the slot on arrival", () => {
    expect(WALK_TILES_PER_SECOND).toBe(2);
    const scene = walkingScene();
    expect(shown(scene, 1000)).toMatchObject({ column: 0, row: 0, direction: "se", moving: true, depth: 1 });
    expect(shown(scene, 1250)).toMatchObject({ column: 0.5, row: 0, direction: "se", moving: true, depth: 1 });
    expect(shown(scene, 1750)).toMatchObject({ column: 1.5, row: 0, direction: "se", moving: true, depth: 2 });
    expect(shown(scene, 2250)).toMatchObject({ column: 2, row: 0.5, direction: "sw", moving: true, depth: 3 });
    expect(scene.frame(2250).changing).toBe(true);
    expect(shown(scene, 2500)).toMatchObject({ column: 2, row: 1, direction: "ne", moving: false, depth: 3 });
    expect(scene.frame(2500).changing).toBe(false);
  });

  it("uses the deeper endpoint for steps towards the back, including nw and ne", () => {
    const scene = createIsoScene(completeTheme, smallRoom());
    scene.apply(world(agent("a", { category: "read" })), 0);
    scene.apply(world(agent("a")), 1000);
    expect(shown(scene, 1250)).toMatchObject({ column: 1.5, row: 1, direction: "nw", depth: 3 });
    expect(shown(scene, 2250)).toMatchObject({ column: 0, row: 0.5, direction: "ne", depth: 1 });
    expect(shown(scene, 2500)).toMatchObject({ column: 0, row: 0, direction: "sw", moving: false });
  });

  it("retargets a mid-walk agent without a jump: it finishes its step, then walks on from there", () => {
    const scene = walkingScene();
    scene.apply(world(agent("a", { category: null, status: "idle" })), 1250);
    expect(shown(scene, 1250)).toMatchObject({ column: 0.5, row: 0, direction: "se", moving: true, depth: 1 });
    expect(shown(scene, 1500)).toMatchObject({ column: 1, row: 0, direction: "nw", moving: true });
    expect(shown(scene, 1750)).toMatchObject({ column: 0.5, row: 0, direction: "nw" });
    expect(shown(scene, 2750)).toMatchObject({ column: 0, row: 1.5, direction: "sw", moving: true });
    expect(shown(scene, 3000)).toMatchObject({ column: 0, row: 2, direction: "nw", moving: false });
  });

  it("does not restart a walk when another snapshot keeps the same station", () => {
    const scene = walkingScene();
    scene.apply(world(agent("a", { category: "read", status: "waiting" })), 1250);
    expect(shown(scene, 1250)).toMatchObject({ column: 0.5, row: 0, moving: true });
    expect(shown(scene, 2500)).toMatchObject({ column: 2, row: 1, moving: false });
  });

  it("preserves a walk when a reassigned place has the same destination tile", () => {
    const room = smallRoom();
    room.stations.rest!.slots[0] = { at: [2, 1], facing: "nw" };
    const scene = createIsoScene(completeTheme, room);
    scene.apply(world(agent("a")), 0);
    scene.apply(world(agent("a", { category: "read" })), 1000);
    scene.apply(world(agent("a", { category: null })), 1250);
    expect(shown(scene, 1250)).toMatchObject({ column: 0.5, row: 0, moving: true });
    expect(shown(scene, 2500)).toMatchObject({ column: 2, row: 1, direction: "nw", moving: false });
  });

  it("teleports when a destination cannot be reached", () => {
    const room = smallRoom();
    room.floor.rows = [". ..", ". ..", ". .."];
    const scene = createIsoScene(dotGrid, room);
    scene.apply(world(agent("a")), 0);
    scene.apply(world(agent("a", { category: "read" })), 100);
    expect(shown(scene, 100)).toMatchObject({ column: 2, row: 1, direction: "ne", moving: false });
  });

  it("setRoom places every live agent at once and cancels all paths", () => {
    const scene = walkingScene();
    scene.frame(1250);
    const room = smallRoom();
    room.stations.read!.slots[0] = { at: [3, 2], facing: "nw" };
    scene.setRoom(room);
    expect(shown(scene, 1250)).toMatchObject({ column: 3, row: 2, direction: "nw", moving: false, depth: 5 });
    expect(scene.frame(1250).changing).toBe(false);
  });

  it("setRoom rebuilds every station key and uses new room capacities", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("a"), agent("b")), 0);
    const room = smallRoom();
    delete room.stations.exec;
    room.stations.rest!.slots.push({ at: [1, 2], facing: "se" });
    scene.setRoom(room);
    expect(scene.frame(0).agents.map((a) => [a.column, a.row, a.direction, a.moving])).toEqual([
      [0, 2, "nw", false], [1, 2, "se", false],
    ]);
  });
});

describe("scene fades", () => {
  it("shows first-snapshot agents at full opacity and fades in late agents", () => {
    expect(FADE_MS).toBe(1000);
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("a")), 100);
    expect(shown(scene, 100).alpha).toBe(1);
    scene.apply(world(agent("a"), agent("b")), 200);
    expect(shown(scene, 200, "b").alpha).toBe(0);
    expect(shown(scene, 700, "b").alpha).toBe(0.5);
    expect(scene.frame(700).changing).toBe(true);
    expect(shown(scene, 1200, "b").alpha).toBe(1);
    expect(scene.frame(1200).changing).toBe(false);
  });

  it("treats an empty first snapshot as the first snapshot", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(), 0);
    scene.apply(world(agent("a")), 100);
    expect(shown(scene, 100).alpha).toBe(0);
  });

  it.each(["done", "lost", "removed"] as const)("fades %s agents, frees their place immediately, and keeps the last look", (status) => {
    const scene = createIsoScene(completeTheme, smallRoom());
    scene.apply(world(agent("a")), 0);
    const before = shown(scene, 0);
    const next = status === "removed" ? world(agent("b")) : world(agent("a", { status }), agent("b"));
    scene.apply(next, 100);
    expect(shown(scene, 100)).toMatchObject({
      column: 0, row: 0, alpha: 1, animation: before.animation,
      direction: before.direction, tint: before.tint, stateColor: before.stateColor,
    });
    expect(shown(scene, 100, "b")).toMatchObject({ column: 0, row: 0 });
    expect(shown(scene, 600).alpha).toBe(0.5);
    scene.apply(next, 800);
    expect(shown(scene, 800).alpha).toBeCloseTo(0.3);
    expect(scene.frame(1100).agents.map((a) => a.key)).toEqual(["b"]);
    expect(scene.frame(1100).changing).toBe(false);
  });

  it("does not show agents already done or lost on the first snapshot", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("done", { status: "done" }), agent("lost", { status: "lost" })), 0);
    expect(scene.frame(0)).toEqual({ agents: [], changing: false });
  });

  it("freezes a disappearing agent at its interpolated walking position", () => {
    const scene = walkingScene();
    scene.apply(world(), 1250);
    expect(shown(scene, 1500)).toMatchObject({
      column: 0.5, row: 0, depth: 1, direction: "se", moving: false,
      animation: "walk/se", alpha: 0.75,
    });
    expect(shown(scene, 2000)).toMatchObject({ column: 0.5, row: 0 });
    expect(scene.frame(2250)).toEqual({ agents: [], changing: false });
  });

  it("restores a fading agent at alpha 1 with a freshly assigned place", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("a")), 0);
    scene.apply(world(agent("b")), 100);
    scene.apply(world(agent("a"), agent("b")), 200);
    expect(shown(scene, 200)).toMatchObject({ column: 1, row: 0, alpha: 1, moving: false });
    expect(shown(scene, 200, "b")).toMatchObject({ column: 0, row: 0 });
  });

  it("starts a fade out at alpha 1 even during an appearance", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(), 0);
    scene.apply(world(agent("a")), 100);
    scene.apply(world(), 200);
    expect(shown(scene, 200).alpha).toBe(1);
    expect(shown(scene, 700).alpha).toBe(0.5);
  });

  it("expires fades during apply even when no frame was requested", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("a")), 0);
    scene.apply(world(), 100);
    scene.apply(world(agent("a")), 1100);
    expect(shown(scene, 1100).alpha).toBe(0);
  });

  it("relocates fading agents on a room change while keeping their look and fade", () => {
    const scene = createIsoScene(completeTheme, smallRoom());
    scene.apply(world(agent("a")), 0);
    scene.apply(world(), 100);
    const room = smallRoom();
    room.stations.exec!.slots[0] = { at: [3, 0], facing: "ne" };
    scene.setRoom(room);
    expect(shown(scene, 600)).toMatchObject({ column: 3, row: 0, direction: "sw", animation: "exec/sw", alpha: 0.5 });
  });
});

describe("scene looks and determinism", () => {
  it.each([
    { status: "working" as const, category: "exec" as const },
    { status: "waiting" as const, category: "read" as const },
    { status: "blocked" as const, category: "exec" as const },
    { status: "idle" as const, category: null },
  ])("resolves the theme's animation and state colour for $status", (over) => {
    const scene = createIsoScene(completeTheme, smallRoom());
    const a = agent("a", over);
    scene.apply(world(a), 100);
    const result = shown(scene, 100);
    expect(result.animation).toBe(resolveAnimation(completeTheme, a, result.direction, false));
    expect(result.stateColor).toBe(completeTheme.states[a.status]!.color);
    expect(SHIRT_COLOURS).toContain(result.tint);
    expect(result.animationTime).toBeGreaterThanOrEqual(0);
    expect(result.animationTime).toBeLessThan(1000);
  });

  it("uses the fallback state colour, as the theme writes it", () => {
    const theme = { ...dotGrid, states: {}, fallback: { ...dotGrid.fallback, state: { ...dotGrid.fallback.state, color: "#A1B2C3" } } };
    const scene = createIsoScene(theme, smallRoom());
    scene.apply(world(agent("a")), 0);
    expect(shown(scene, 0).stateColor).toBe("#A1B2C3");
    scene.setTheme({ ...theme, fallback: { ...theme.fallback, state: { ...theme.fallback.state, color: "red" } } });
    expect(shown(scene, 100).stateColor).toBe("red");
  });

  it("restarts animation time only for a new name and includes a stable phase", () => {
    const scene = createIsoScene(completeTheme, smallRoom());
    scene.apply(world(agent("a")), 100);
    const phase = shown(scene, 100).animationTime;
    expect(shown(scene, 350).animationTime).toBe(phase + 250);
    scene.apply(world(agent("a")), 400);
    expect(shown(scene, 400).animationTime).toBe(phase + 300);
    scene.apply(world(agent("a", { status: "waiting" })), 500);
    expect(shown(scene, 500)).toMatchObject({ animation: "waiting/sw", animationTime: phase });
    expect(shown(scene, 650).animationTime).toBe(phase + 150);
  });

  it("starts step and arrival animations at their actual boundaries across skipped frames", () => {
    const scene = walkingScene();
    const phase = shown(scene, 1000).animationTime;
    expect(shown(scene, 1750)).toMatchObject({ animation: "walk/se", animationTime: phase + 750 });
    expect(shown(scene, 2250)).toMatchObject({ animation: "walk/sw", animationTime: phase + 250 });
    expect(shown(scene, 2750)).toMatchObject({ animation: "read/ne", animationTime: phase + 250 });
    const skipped = walkingScene();
    expect(shown(skipped, 2750)).toEqual(shown(scene, 2750));
  });

  it("applies a changed theme on the next frame and keeps tint and phase stable", () => {
    const scene = createIsoScene(completeTheme, smallRoom());
    scene.apply(world(agent("a")), 0);
    const before = shown(scene, 0);
    scene.setTheme(dotGrid);
    expect(shown(scene, 100)).toMatchObject({ animation: null, tint: before.tint, stateColor: "#4cc38a", animationTime: before.animationTime });
    const other = createIsoScene(dotGrid, placeholderRoom(dotGrid));
    other.apply(world(agent("a")), 0);
    expect(shown(other, 0).tint).toBe(before.tint);
    expect(shown(other, 0).animationTime).toBe(before.animationTime);
  });

  it("keeps fading looks after a theme change", () => {
    const scene = createIsoScene(completeTheme, smallRoom());
    scene.apply(world(agent("a")), 0);
    const before = shown(scene, 0);
    scene.apply(world(), 100);
    scene.setTheme({ ...dotGrid, states: { working: { color: "#000000", animation: "none" } } });
    expect(shown(scene, 200)).toMatchObject({ animation: before.animation, tint: before.tint, stateColor: before.stateColor });
  });

  it("produces identical frames for identical applies and times regardless of input insertion order", () => {
    const a = createIsoScene(completeTheme, parseRoom(officeJson).room!);
    const b = createIsoScene(completeTheme, parseRoom(officeJson).room!);
    const initial = Array.from({ length: 200 }, (_, i) => agent(`agent-${i}`, { firstTs: i, category: "exec" }));
    a.apply(world(...initial), 0);
    b.apply(world(...initial.slice().reverse()), 0);
    expect(a.frame(0)).toEqual(b.frame(0));
    const next = initial.slice(0, 180).map((item) => ({ ...item, category: "delegate" as const }));
    a.apply(world(...next), 100);
    b.apply(world(...next.slice().reverse()), 100);
    for (const now of [100, 350, 600, 1100, 2100, 10_000]) expect(a.frame(now)).toEqual(b.frame(now));
  });

  it("returns detached frame values that callers can safely change", () => {
    const scene = createIsoScene(dotGrid, smallRoom());
    scene.apply(world(agent("a")), 0);
    const frame = scene.frame(0);
    frame.agents[0]!.offset.x = 999;
    frame.agents[0]!.column = 999;
    expect(shown(scene, 0)).toMatchObject({ column: 0, offset: { x: 0, y: 0 } });
  });
});

import { describe, expect, it } from "vitest";
import { diffWorld, emptyWorld, replay, type ServerMessage, type WorldState } from "@agentarium/core";
import { connect, type ConnectionStatus, type SocketLike } from "../src/connection";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.();
  }
  push(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const ref = { machine: "m", provider: "p", session: "s", agent: "root" };
const w1 = replay([{ schema_version: 1, kind: "prompt", ts: 1, agent: ref }]);
const w2 = replay([{ schema_version: 1, kind: "stop", ts: 2, agent: ref }], undefined, w1);

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: (() => void)[] = [];
  const statuses: ConnectionStatus[] = [];
  const worlds: WorldState[] = [];
  const conn = connect({
    url: "ws://x",
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
    onStatus: (s) => statuses.push(s),
    onUpdate: (_m, w) => worlds.push(w),
  });
  return { conn, sockets, timers, statuses, worlds };
}

describe("connect", () => {
  it("applies snapshot then patch", () => {
    const { sockets, worlds } = setup();
    sockets[0]!.push({ type: "snapshot", room: "r", seq: 3, world: w1 });
    sockets[0]!.push({ type: "patch", room: "r", seq: 4, patch: diffWorld(w1, w2) });
    expect(worlds.at(-1)).toEqual(w2);
  });

  it("asks for a resync on a gap and does not apply the patch", () => {
    const { sockets, worlds } = setup();
    sockets[0]!.push({ type: "snapshot", room: "r", seq: 3, world: emptyWorld() });
    sockets[0]!.push({ type: "patch", room: "r", seq: 9, patch: diffWorld(w1, w2) });
    expect(sockets[0]!.sent.map((s) => JSON.parse(s))).toEqual([{ type: "resync" }]);
    expect(worlds).toHaveLength(1);
  });

  it("reconnects after the socket closes, but not after close()", () => {
    const { conn, sockets, timers, statuses } = setup();
    sockets[0]!.close();
    expect(statuses.at(-1)).toBe("closed");
    timers[0]!();
    expect(sockets).toHaveLength(2);
    conn.close();
    expect(timers).toHaveLength(1);
  });
});

describe("rooms", () => {
  it("forwards room lists, joins on request, and ignores traffic from other rooms", () => {
    const sockets: FakeSocket[] = [];
    const worlds: WorldState[] = [];
    const lists: number[] = [];
    const conn = connect({
      url: "ws://x",
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimer: () => 0,
      clearTimer: () => {},
      onStatus: () => {},
      onUpdate: (_m, w) => worlds.push(w),
      onRooms: (r) => lists.push(r.length),
    });
    const s = sockets[0]!;
    s.onmessage?.({ data: JSON.stringify({ type: "rooms", rooms: [{ id: "a" }, { id: "b" }] }) });
    expect(lists).toEqual([2]);

    s.push({ type: "snapshot", room: "a", seq: 1, world: w1 });
    conn.join("b");
    expect(s.sent.map((x) => JSON.parse(x))).toEqual([{ type: "join", room: "b" }]);
    // A late patch from the old room must not be applied while the switch is pending.
    s.push({ type: "patch", room: "a", seq: 2, patch: diffWorld(w1, w2) });
    expect(worlds).toHaveLength(1);
    s.push({ type: "snapshot", room: "b", seq: 7, world: w2 });
    expect(worlds.at(-1)).toEqual(w2);
    s.push({ type: "patch", room: "a", seq: 8, patch: diffWorld(w1, w2) });
    expect(worlds).toHaveLength(2);
  });
});

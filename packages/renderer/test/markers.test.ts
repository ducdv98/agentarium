import { describe, expect, it } from "vitest";
import { AGENT_STATES, needsInput, visibleAgents } from "@agentarium/core";
import { dotGrid, needsInputMarkers } from "../src";
import { agent, world } from "./fixtures/world";

/** A small seeded PRNG, so a failure can be reproduced. */
function random(seed: number): () => number {
  let a = seed;
  return () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296);
}

describe("needsInputMarkers", () => {
  it("marks exactly the agents core's needsInput flags, in visible order", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = random(seed);
      const agents = Array.from({ length: 30 }, (_, i) =>
        agent(`a${i}`, {
          status: AGENT_STATES[Math.floor(rnd() * AGENT_STATES.length)]!,
          // A tree: the parent is an earlier agent, or one the world no longer has.
          parent: i && rnd() < 0.7 ? (rnd() < 0.1 ? "gone" : `a${Math.floor(rnd() * i)}`) : null,
        }),
      );
      const w = world(...agents);
      const expected = visibleAgents(w).filter((a) => needsInput(w, a.key)).map((a) => a.key);
      expect(needsInputMarkers(dotGrid, w).map((m) => m.key)).toEqual(expected);
    }
  });
});

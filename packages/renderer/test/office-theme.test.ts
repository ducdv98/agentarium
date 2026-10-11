import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_CATEGORIES } from "@agentarium/core";
import { office, shippedThemes } from "../src";

describe("office", () => {
  it("ships stations matching the room's labels and slots", () => {
    expect(shippedThemes).toContain(office);
    expect(office.id).toBe("office");
    const layout = JSON.parse(readFileSync(join(__dirname, "../../../assets/src/scenes/office-room/layout.json"), "utf8"));
    for (const key of [...ACTION_CATEGORIES, "rest"] as const) {
      const station = key === "rest" ? office.rest : office.stations[key];
      expect(station).toEqual({ id: key, label: layout.stations[key].label, capacity: layout.stations[key].slots.length });
    }
    expect(office.palette.alert).not.toBe(office.states.working!.color);
    expect(office.palette.alert).not.toBe(office.states.idle!.color);
  });
});

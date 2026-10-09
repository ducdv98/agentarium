import type { RoomSummary } from "@agentarium/core";

/**
 * Which room the UI should show. A manual choice wins while that room exists. In auto mode
 * the current room is kept, unless it has disappeared or another room needs the user while
 * this one does not (triage first); then the best candidate is the room that needs the user
 * most, else the most recently active.
 */
export function pickRoom(rooms: readonly RoomSummary[], current: string | null, manual: string | null): string | null {
  if (manual && rooms.some((r) => r.id === manual)) return manual;
  const best = [...rooms].sort((a, b) => b.waiting - a.waiting || b.lastActive - a.lastActive)[0];
  if (!best) return null;
  const cur = rooms.find((r) => r.id === current);
  if (cur && !(best.waiting > 0 && cur.waiting === 0)) return cur.id;
  return best.id;
}

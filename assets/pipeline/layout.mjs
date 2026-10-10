// Room layouts: where a scene asset's parts go on the tile grid, and where Agents stand at each Station.
// The format is described in assets/README.md, "Room layouts".

/** The nine action categories (ADR 0004, frozen) and the rest area, in Theme order. */
export const STATIONS = ["read", "write", "exec", "search", "network", "delegate", "think", "wait", "error", "rest"];
export const FACINGS = ["ne", "nw", "se", "sw"];

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** A wall stands on the tile edge behind it: the neighbour across that edge, and the edge's name. */
const WALL_EDGE = { sw: [[0, -1], "ne"], se: [[-1, 0], "nw"], ne: [[0, 1], "sw"], nw: [[1, 0], "se"] };
const key = ([c, r]) => `${c},${r}`;
const show = (at) => `[${at}]`;
const isTile = (at) => Array.isArray(at) && at.length === 2 && at.every(Number.isInteger);

/** Returns every problem with `layout`; empty means it is well formed. `parts` are the asset's rendered parts. */
export function validateLayout(layout, parts) {
  const problems = [];
  const known = new Set(parts ?? []);
  const [cols, rows] = Array.isArray(layout?.size) ? layout.size : [];
  if (!(Number.isInteger(cols) && cols > 0 && Number.isInteger(rows) && rows > 0)) {
    return ["size: needs [columns, rows]"];
  }

  const floor = new Set();
  const legend = layout.floor?.legend ?? {};
  for (const [char, part] of Object.entries(legend)) {
    if (char.length !== 1 || char === " ") problems.push(`floor.legend.${char}: needs one character, not a space`);
    if (!known.has(part)) problems.push(`floor.legend.${char}: ${part} is not a part`);
  }
  const floorRows = Array.isArray(layout.floor?.rows) ? layout.floor.rows : [];
  if (floorRows.length !== rows) problems.push(`floor.rows: needs ${rows} rows`);
  floorRows.forEach((line, r) => {
    if (typeof line !== "string" || line.length !== cols) problems.push(`floor.rows.${r}: needs ${cols} tiles`);
    [...String(line)].slice(0, cols).forEach((char, c) => {
      if (char === " ") return; // no floor here
      if (!(char in legend)) problems.push(`floor.rows.${r}: ${char} is not in the legend`);
      else floor.add(key([c, r]));
    });
  });

  const list = (field) => {
    if (layout[field] === undefined) return [];
    if (Array.isArray(layout[field])) return layout[field];
    problems.push(`${field}: not a list`);
    return [];
  };
  const seats = new Set(list("seats"));
  for (const seat of seats) if (!known.has(seat)) problems.push(`seats: ${seat} is not a part`);
  const blocked = new Map();
  const seated = new Set();
  const place = (where, item, track) => {
    if (!known.has(item?.part)) problems.push(`${where}: ${item?.part} is not a part`);
    if (!FACINGS.includes(item?.facing)) problems.push(`${where}: facing ${item?.facing} is not a direction`);
    if (item?.front !== undefined && typeof item.front !== "boolean") problems.push(`${where}: front must be true or false`);
    if (!isTile(item?.at) || !floor.has(key(item.at))) return void problems.push(`${where}: ${show(item?.at)} is not a floor tile`);
    if (!track) return;
    const at = key(item.at);
    if (seats.has(item.part)) {
      if (seated.has(at)) problems.push(`${where}: ${show(item.at)} already has a seat`);
      seated.add(at);
    } else {
      if (blocked.has(at)) problems.push(`${where}: ${show(item.at)} already has a prop`);
      else blocked.set(at, item.part);
    }
  };
  list("walls").forEach((wall, i) => {
    place(`walls.${i}`, wall, false);
    const [[dc, dr], edge] = WALL_EDGE[wall?.facing] ?? [[0, 0]];
    // Walls bound the room; one inside it would cut a walk the reachability check below cannot see.
    if (edge && isTile(wall.at) && floor.has(key([wall.at[0] + dc, wall.at[1] + dr]))) {
      problems.push(`walls.${i}: the ${edge} edge of ${show(wall.at)} is inside the room`);
    }
  });
  list("props").forEach((prop, i) => place(`props.${i}`, prop, true));

  const stations = layout.stations ?? {};
  for (const name of Object.keys(stations)) {
    if (!STATIONS.includes(name)) problems.push(`stations.${name}: not an action category or rest`);
  }
  const owners = new Map();
  const reachable = [];
  for (const name of STATIONS) {
    const station = stations[name];
    if (!station) {
      problems.push(`stations.${name}: missing`);
      continue;
    }
    if (typeof station.label !== "string" || !station.label) problems.push(`stations.${name}: needs a label`);
    const slots = Array.isArray(station.slots) ? station.slots : [];
    if (!slots.length) problems.push(`stations.${name}: needs at least one slot`);
    slots.forEach((slot, i) => {
      const where = `stations.${name}.slots.${i}`;
      if (!FACINGS.includes(slot?.facing)) problems.push(`${where}: facing ${slot?.facing} is not a direction`);
      if (!isTile(slot?.at) || !floor.has(key(slot.at))) return void problems.push(`${where}: ${show(slot?.at)} is not a floor tile`);
      const at = key(slot.at);
      if (blocked.has(at)) return void problems.push(`${where}: ${show(slot.at)} is blocked by ${blocked.get(at)}`);
      if (owners.has(at)) return void problems.push(`${where}: ${show(slot.at)} is already a slot of ${owners.get(at)}`);
      owners.set(at, name);
      reachable.push([where, slot.at]);
    });
  }

  // Agents walk between Stations over floor tiles without a blocking prop.
  if (reachable.length) {
    const start = reachable[0][1];
    const seen = new Set([key(start)]);
    const queue = [start];
    while (queue.length) {
      const [c, r] = queue.shift();
      for (const [dc, dr] of NEIGHBOURS) {
        const next = [c + dc, r + dr];
        const k = key(next);
        if (floor.has(k) && !blocked.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(next);
        }
      }
    }
    for (const [where, at] of reachable) {
      if (!seen.has(key(at))) problems.push(`${where}: ${show(at)} cannot be reached from ${show(start)}`);
    }
  }
  return problems;
}

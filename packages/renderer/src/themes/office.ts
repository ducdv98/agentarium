import type { Clip, Theme } from "../theme";

const clip = (name: string): Clip => ({ ne: `${name}/ne`, nw: `${name}/nw`, se: `${name}/se`, sw: `${name}/sw` });

/** The warm office scene, with a station for every action category. */
export const office: Theme = {
  id: "office",
  name: "Office",
  vocabulary: { lead: "Lead", member: "Teammate", room: "Office" },
  palette: { background: "#24262d", ink: "#dad3c6", alert: "#ff705e" },
  states: {
    working: { color: "#79bb86", animation: "none" },
    idle: { color: "#a89b88", animation: "none" },
    waiting: { color: "#ffc34f", animation: "pulse" },
    blocked: { color: "#ff705e", animation: "blink" },
    lost: { color: "#625e5c", animation: "fade" },
    done: { color: "#8cc4ee", animation: "none" },
  },
  stations: {
    read: { id: "read", label: "Library", capacity: 3 },
    write: { id: "write", label: "Desks", capacity: 8 },
    exec: { id: "exec", label: "Server racks", capacity: 3 },
    search: { id: "search", label: "Filing cabinets", capacity: 2 },
    network: { id: "network", label: "Comms desks", capacity: 2 },
    delegate: { id: "delegate", label: "Meeting room", capacity: 6 },
    think: { id: "think", label: "Whiteboards", capacity: 4 },
    wait: { id: "wait", label: "Water cooler", capacity: 2 },
    error: { id: "error", label: "Printer", capacity: 2 },
  },
  rest: { id: "rest", label: "Lounge", capacity: 6 },
  fallback: {
    state: { color: "#c9b79a", animation: "none" },
    station: { id: "other", label: "Other", capacity: 6 },
  },
  renderers: {
    "2d": {
      atlases: ["atlases/office-worker.json", "atlases/office-room.json"],
      room: "src/scenes/office-room/layout.json",
      walk: clip("walk"),
      states: { idle: clip("idle"), waiting: clip("waiting"), blocked: clip("blocked") },
      categories: {
        read: clip("read"),
        write: clip("write"),
        exec: clip("exec"),
        search: clip("search"),
        network: clip("network"),
        delegate: clip("delegate"),
        think: clip("think"),
        wait: clip("wait"),
        error: clip("error"),
      },
    },
  },
};

import type { Theme } from "../theme";

/** The minimal theme: coloured dots on a grid. Doubles as the check that the core has no theme assumptions. */
export const dotGrid: Theme = {
  id: "dot-grid",
  name: "Dot grid",
  vocabulary: { lead: "Lead", member: "Member", room: "Room" },
  palette: { background: "#101418", ink: "#9aa5b1", alert: "#ff5d5d" },
  states: {
    working: { color: "#4cc38a", animation: "none" },
    idle: { color: "#6b7785", animation: "none" },
    waiting: { color: "#ffb454", animation: "pulse" },
    blocked: { color: "#ff5d5d", animation: "blink" },
    lost: { color: "#3a424c", animation: "fade" },
    done: { color: "#3d6fb6", animation: "none" },
  },
  stations: {
    read: { id: "read", label: "read", capacity: 8 },
    write: { id: "write", label: "write", capacity: 8 },
    exec: { id: "exec", label: "exec", capacity: 8 },
    search: { id: "search", label: "search", capacity: 8 },
    network: { id: "network", label: "network", capacity: 8 },
    delegate: { id: "delegate", label: "delegate", capacity: 8 },
    think: { id: "think", label: "think", capacity: 8 },
    wait: { id: "wait", label: "wait", capacity: 8 },
    error: { id: "error", label: "error", capacity: 8 },
  },
  rest: { id: "rest", label: "rest", capacity: 8 },
  fallback: {
    state: { color: "#c084fc", animation: "none" },
    station: { id: "other", label: "other", capacity: 8 },
  },
};

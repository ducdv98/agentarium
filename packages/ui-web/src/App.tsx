import { useEffect, useMemo, useRef, useState } from "react";
import { emptyWorld, type WorldState } from "@agentarium/core";
import { createDotGridRenderer, dotGrid, type Renderer } from "@agentarium/renderer";
import { connect, type ConnectionStatus } from "./connection";
import { buildRoster, needsInputCount } from "./roster";

/** `?token=` is required; `?daemon=host:port` points a dev server at the daemon (default: same origin). */
function daemonUrl(): string | null {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  if (!token) return null;
  const host = params.get("daemon") ?? location.host;
  const room = params.get("room");
  return `ws://${host}/ws?token=${encodeURIComponent(token)}${room ? `&room=${encodeURIComponent(room)}` : ""}`;
}

const theme = dotGrid;

export function App() {
  const url = useMemo(daemonUrl, []);
  const stage = useRef<HTMLDivElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const [world, setWorld] = useState<WorldState>(emptyWorld());
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const r = createDotGridRenderer(theme);
    r.mount(el);
    renderer.current = r;
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      r.dispose();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!url) return;
    const conn = connect({
      url,
      onStatus: setStatus,
      onUpdate: (msg, w) => {
        // The canvas is driven imperatively; only the roster goes through React state.
        renderer.current?.applyState(
          msg.type === "snapshot" ? { kind: "snapshot", world: msg.world } : { kind: "patch", patch: msg.patch },
        );
        setWorld(w);
      },
    });
    return () => conn.close();
  }, [url]);

  const rows = useMemo(() => buildRoster(world), [world]);
  const waiting = needsInputCount(rows);

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <h1>Agentarium</h1>
          <p className={`status status-${status}`}>{status}</p>
          <p className={waiting > 0 ? "triage triage-alert" : "triage"}>
            {waiting > 0 ? `${waiting} need${waiting === 1 ? "s" : ""} you` : "No one needs you"}
          </p>
        </header>
        {!url && <p className="notice">Open this page with ?token=… (printed by “agentarium start”).</p>}
        <ul className="roster">
          {rows.map((r) => (
            <li
              key={r.key}
              className={r.needsInput ? "row row-alert" : "row"}
              style={{ paddingLeft: 12 + r.depth * 16 }}
            >
              <span className="dot" style={{ background: (theme.states[r.status] ?? theme.fallback.state).color }} />
              <span className="label">
                {r.label}
                {r.lead && <em> · {theme.vocabulary.lead}</em>}
                {r.member && <em> · {theme.vocabulary.member}</em>}
              </span>
              <span className="meta">
                {r.needsInput && r.status !== "waiting" ? "sub-agent waiting" : r.status}
                {r.category ? ` · ${r.category}` : ""}
                {r.summary ? ` · ${r.summary}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </aside>
      <main className="stage" ref={stage} />
    </div>
  );
}

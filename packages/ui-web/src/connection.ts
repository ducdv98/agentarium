import { createPatchClient, type ServerMessage, type WorldState } from "@agentarium/core";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface ConnectionOptions {
  url: string;
  /** `snapshot` replaces everything; `patch` is a delta already applied to `world`. */
  onUpdate(msg: ServerMessage, world: WorldState): void;
  onStatus(status: ConnectionStatus): void;
  createSocket?: (url: string) => SocketLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/** Keeps a WebSocket to the daemon: applies snapshot and patches, resyncs on a gap, reconnects with backoff. */
export function connect(opts: ConnectionOptions): { close(): void } {
  const create = opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let socket: SocketLike | null = null;
  let timer: unknown = null;
  let delay = 500;
  let closed = false;

  const open = (): void => {
    opts.onStatus("connecting");
    const client = createPatchClient();
    const ws = create(opts.url);
    socket = ws;
    ws.onopen = () => {
      delay = 500;
      opts.onStatus("open");
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (client.handle(msg) === "gap") {
        ws.send(JSON.stringify({ type: "resync" }));
        return;
      }
      opts.onUpdate(msg, client.world);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      opts.onStatus("closed");
      if (closed) return;
      timer = setTimer(open, delay);
      delay = Math.min(delay * 2, 5_000);
    };
  };
  open();

  return {
    close() {
      closed = true;
      if (timer !== null) clearTimer(timer);
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}

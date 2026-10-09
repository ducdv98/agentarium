/** Bump when the wire protocol or on-disk log changes incompatibly; `start` refuses to share a port across versions. */
export const DAEMON_VERSION = "0.1.0";
export const DEFAULT_PORT = 47821;

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AGENTARIUM_PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid AGENTARIUM_PORT: ${raw}`);
  }
  return port;
}

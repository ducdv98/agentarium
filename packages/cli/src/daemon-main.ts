// Entry point of the detached daemon process (spawned by `agentarium start`).
import { rmSync, writeFileSync } from "node:fs";
import { DAEMON_VERSION, resolvePort, startDaemon } from "@agentarium/server";
import { agentariumHome, daemonFile, dataDir, readOrCreateToken } from "./paths";

const home = agentariumHome();
const daemon = await startDaemon({
  port: resolvePort(),
  dataDir: dataDir(home),
  token: readOrCreateToken(home),
});
writeFileSync(daemonFile(home), JSON.stringify({ pid: process.pid, port: daemon.port, version: DAEMON_VERSION }));
console.log(`agentarium daemon v${DAEMON_VERSION} listening on 127.0.0.1:${daemon.port}`);

const shutdown = (): void => {
  rmSync(daemonFile(home), { force: true });
  void daemon.close().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

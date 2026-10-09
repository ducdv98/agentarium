#!/usr/bin/env node
import { contextFromEnv, init, start, stop, uninstall } from "./commands";

const USAGE = "usage: agentarium <init|uninstall|start|stop>";

async function main(argv: string[]): Promise<number> {
  const ctx = contextFromEnv();
  switch (argv[0]) {
    case "init": {
      const r = init(ctx);
      console.log(
        r.changed
          ? `Hooks written to ${r.settingsPath} (port ${r.port})${r.backedUp ? "; original backed up" : ""}.`
          : `Hooks already up to date in ${r.settingsPath}.`,
      );
      return 0;
    }
    case "uninstall": {
      const r = uninstall(ctx);
      console.log(
        r.changed
          ? `Hooks removed from ${r.settingsPath}${r.restoredBackup ? " (backup restored)" : ""}.`
          : "Nothing to remove.",
      );
      return 0;
    }
    case "start": {
      const r = await start(ctx);
      const what = r.status === "started" ? "started" : "already running";
      console.log(`Daemon ${what} on 127.0.0.1:${r.port} (pid ${r.pid}).`);
      return 0;
    }
    case "stop": {
      const r = await stop(ctx);
      console.log(r.status === "stopped" ? `Daemon stopped (pid ${r.pid}).` : "Daemon is not running.");
      return 0;
    }
    default:
      console.error(USAGE);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);

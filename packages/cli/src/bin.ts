#!/usr/bin/env node
import { forwardCodexHook } from "./codex-hook";
import { readOrCreateToken } from "./paths";
import { contextFromEnv, differentVersionMessage, init, start, stop, uninstall } from "./commands";

const USAGE = "usage: agentarium <init|uninstall|start|stop|hook codex --port <n> [--home <dir>]>";

async function main(argv: string[]): Promise<number> {
  const ctx = contextFromEnv();
  switch (argv[0]) {
    case "init": {
      const r = await init(ctx);
      console.log(
        r.changed
          ? `Hooks written to ${r.settingsPath} (port ${r.port})${r.backedUp ? "; original backed up" : ""}.`
          : `Hooks already up to date in ${r.settingsPath}.`,
      );
      console.log(
        r.codex === "skipped"
          ? `Codex hooks skipped (${r.codexHooksPath}: Codex home not found).`
          : r.codex.changed
            ? `Codex hooks written to ${r.codexHooksPath}. Hooks need review in Codex before they run.`
            : `Codex hooks already up to date in ${r.codexHooksPath}.`,
      );
      if (r.daemon === "not-running") {
        console.log("Hooks will do nothing until the daemon runs. Start it with: agentarium start");
      } else if (r.daemon === "other-version") {
        console.log(differentVersionMessage(r.version, r.port));
      }
      return 0;
    }
    case "uninstall": {
      const r = uninstall(ctx);
      console.log(
        r.changed
          ? `Hooks removed from ${r.settingsPath}${r.restoredBackup ? " (backup restored)" : ""}.`
          : "Nothing to remove.",
      );
      console.log(
        r.codex === "skipped"
          ? "Codex hooks not installed."
          : r.codex.changed
            ? `Codex hooks removed from ${r.codexHooksPath}${r.codex.restoredBackup ? " (backup restored)" : ""}.`
            : "No Codex hooks to remove.",
      );
      return 0;
    }
    case "hook": {
      const flag = (name: string) => argv[argv.indexOf(name) + 1];
      if (argv[1] === "codex" && argv.includes("--port")) {
        await forwardCodexHook({ home: argv.includes("--home") ? flag("--home") ?? ctx.home : ctx.home, port: Number(flag("--port")) });
      }
      return 0;
    }
    case "start": {
      const r = await start(ctx);
      const what = r.status === "started" ? "started" : "already running";
      console.log(`Daemon ${what} on 127.0.0.1:${r.port} (pid ${r.pid}).`);
      console.log(`Open http://127.0.0.1:${r.port}/?token=${readOrCreateToken(ctx.home)}`);
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
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (process.argv[2] !== "hook") console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = process.argv[2] === "hook" ? 0 : 1;
  },
);

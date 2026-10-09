// Usage: pnpm --filter @agentarium/loadgen loadgen -- [--agents 200] [--duration 30] [--speed 1] [--port N] [--token T] [--seed 1]
// Without --port/--token it reads the running daemon's port and token from $AGENTARIUM_HOME (default ~/.agentarium).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateScript } from "./generate";
import { runLoad } from "./run";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set((process.argv[i] ?? "").replace(/^--/, ""), process.argv[i + 1] ?? "");
}
const home = process.env.AGENTARIUM_HOME || join(homedir(), ".agentarium");
const port = Number(args.get("port") ?? process.env.AGENTARIUM_PORT ?? 47821);
const token = args.get("token") ?? readFileSync(join(home, "token"), "utf8").trim();

const script = generateScript({
  agents: Number(args.get("agents") ?? 200),
  durationMs: Number(args.get("duration") ?? 30) * 1000,
  seed: Number(args.get("seed") ?? 1),
});
console.log(`Playing ${script.length} events against 127.0.0.1:${port}`);
const report = await runLoad({ port, token, script, speed: Number(args.get("speed") ?? 1) });
console.log(report);
process.exitCode = report.failed > 0 ? 1 : 0;

# 12: Skip the `codex-live` tests when Unix sockets are unavailable

**What to build:** On the owner's Windows machine, three tests in `packages/server/test/codex-live.test.ts` fail with `listen EACCES` on `%TEMP%\...\control.sock`. A plain `net.createServer().listen()` on a socket in Temp fails the same way, inside and outside the Claude sandbox, so this is the environment, not our code. Probe for Unix-socket support and skip with a clear reason when it's missing. Also check whether Codex itself can create its control socket on this machine. If it can't, the live-approval path has never run here.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The tests skip with a printed reason when the probe fails, and still run in CI on all three operating systems
- [ ] Findings on Codex's own socket on this machine are recorded under `## Answer`

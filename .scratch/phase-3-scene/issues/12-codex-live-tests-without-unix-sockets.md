# 12: Skip the `codex-live` tests when Unix sockets are unavailable

**What to build:** On the owner's Windows machine, three tests in `packages/server/test/codex-live.test.ts` fail with `listen EACCES` on `%TEMP%\...\control.sock`. A plain `net.createServer().listen()` on a socket in Temp fails the same way, inside and outside the Claude sandbox, so this is the environment, not our code. Probe for Unix-socket support and skip with a clear reason when it's missing. Also check whether Codex itself can create its control socket on this machine. If it can't, the live-approval path has never run here.

**Blocked by:** None (can start immediately)

**Status:** resolved. The owner accepted skipping the Unix-socket tests on Windows CI; the proxy test covers Codex live there.

- [x] The tests skip with a printed reason when the probe fails, and still run in CI on all three operating systems (the tests run on Linux and macOS CI; Windows CI skips them because Node there cannot serve a .sock path)
- [x] Findings on Codex's own socket on this machine are recorded under `## Answer`

## Answer

Probed on 2026-10-11 on the owner's Windows 11 machine (Node 24.18.0, codex-cli 0.162.1), from inside Claude Code.

**Node can't open a local socket server here.** `net.createServer().listen(path)` fails with `EACCES` for a `.sock` path in `%TEMP%`, in the repo, in the home directory and at `F:\`. It also fails for a named pipe (`\\.\pipe\agp-probe`). On Windows, Node's `listen(path)` and `connect(path)` always go through named pipes (libuv has no AF_UNIX support there). So a filesystem `.sock` path can't work on Windows even where pipes are allowed. Windows CI has failed `pnpm test` on every main run since 533f4e1 (the last green run is a9d533d). That's consistent with these tests, but the job logs need auth, so the failing tests weren't confirmed.

**Codex does create its control socket.** `~/.codex/app-server-control/app-server-control.sock` exists, owned by the running app-server daemon (pid 32912 in `app-server-daemon/daemon.pid`), and carries reparse tag `0x80000023` (IO_REPARSE_TAG_AF_UNIX). That makes it a real Windows AF_UNIX socket, which Codex (Rust) creates natively.

**Agentarium has never reached it.** `net.connect()` to that socket fails with `EACCES`, because Node opens it as a pipe. The real daemon never even gets that far. `~/.agentarium/daemon.log` only ever logs `codex live: unavailable (Invalid URL: ws+unix://C:\Users\ducdev\.codex\app-server-control\app-server-control.sock:/)`. `ws` rejects a drive-letter path in the `ws+unix://` URL. So on Windows the live-approval path has never run, and Codex sessions there fall back to hooks only. Fixing that would need an AF_UNIX client that doesn't go through Node's `net` (or a Codex transport other than the Unix socket). That's a follow-up ticket, not part of this one.

**The tests now:** a top-level probe listens on a `.sock` in a fresh temp dir. When it fails, the three socket tests in `codex-live.test.ts` skip and print `codex-live: skipping Unix-socket tests (<reason>)`, and the missing-socket test still runs. When `CI` is set on Linux or macOS the probe result is ignored, so a broken runner fails loudly instead of skipping. On Windows the tests skip everywhere, CI included, because Node there can't serve a `.sock` path at all.

## Comments

- 2026-10-11: Codex live now works on Windows. Two things blocked it. `ws` rejected the drive-letter `ws+unix://` URL, and Node on Windows can't open an AF_UNIX socket anyway. `startCodexLive` now speaks WebSocket over the stdio of `codex app-server proxy --sock <path>` (the default on Windows; `proxy` option). It spawns the proxy only once the socket exists. That check uses `lstat` and treats only ENOENT as missing, because Node gets EACCES when it stats the AF_UNIX reparse point (`existsSync` returns false for it). The real daemon now logs `codex live: connected` and `/health` reports `codexLive: true`. A new test runs the proxy path on every OS (a fake proxy relays to TCP); the three Unix-socket tests still skip on Windows.

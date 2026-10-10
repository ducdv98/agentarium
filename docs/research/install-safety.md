# Claude Code hook install safety

Research date: 2026-10-10. Read-only source research; this report is the only
repository change. Ideas only, following [ADR 0001](../adr/0001-build-independently-of-pixel-agents.md).

Agentarium inspected at `8375cf48c466aba934e85308a709c7e937f8e13c`.
The requested `src/adapters` lives at `packages/adapters/src` in this checkout.
Pixel Agents inspected from a temporary clone at
`d1e007a9fdf3003c252d2973abe1999ae59aec33`. The requested
[pablodelucca/pixel-agents URL](https://github.com/pablodelucca/pixel-agents)
now redirects to `pixel-agents-hq/pixel-agents`; this is the redirected
repository, not a separately selected look-alike. Links below pin that revision.
The findings come from implementation and existing tests, not just the README.
Neither project's hook installer was run against real user settings; test suites
were read, not executed. Candidate acceptance criteria below are proposed tests.

## How Pixel Agents does it

**Install and token gate.** Fresh standalone startup starts the server but waits
for consent in the browser before modifying Claude settings. The operator gets
a URL containing the server token. The WebSocket handshake must present the
correct, nonempty token to become privileged; tokenless standalone viewers can
watch but cannot approve, install or remove hooks. Both consent responses and
the settings toggle check that privilege. Embedded VS Code connections use
bearer authentication. Loopback addresses and Host/Origin checks alone are
explicitly insufficient for approving a persistent settings change.
[Transport gate](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/httpServer.ts),
[message handling](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/clientMessageHandler.ts).

This qualifies the prior-art shorthand “hook install refused without token”:
the **remote control path** is token-gated. The low-level settings installer
takes no token, and the Claude provider wrapper ignores its URL/token arguments.
It does not enforce a universal token precondition on local calls. Installed
commands instead discover current server tokens from local files at execution
time. [Provider wrapper](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/claude.ts).

Consent is stored per provider and shared across the CLI and extension. The
disclosure names the global settings file, backup, event count, tool names and
inputs, local destination, network-exposure exception and removal route.
Answers are serialized within a process; revised answers can undo installation.
Preferences are persisted only when re-reading installation state agrees with
the requested state. Detection treats any owned hook, including a legacy event,
as installed. Pre-consent installs are silently granted consent and migrated;
fresh installs require an answer. This migration is an upstream policy choice,
not proof that every partial old install has already authorized the full set.
[Consent policy](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/consentGate.ts),
[executor](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/consentExecutor.ts),
[disclosure](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/consentCopy.ts).

**Scope and delivery.** It writes catch-all command hooks into
`~/.claude/settings.json`, not project settings. The installer hardcodes this
home-relative location; it does not honor `CLAUDE_CONFIG_DIR`. It first copies
the bundled script to `~/.pixel-agents/hooks/claude-hook.js`; failed copy prevents
adding entries. Each command invokes Node with a quoted absolute script path
and a five-second hook timeout. Twelve events are installed, including
`SessionStart`, session end, tools, permissions, notifications, sub-agents and
two Agent Teams events. It deliberately removes old `UserPromptSubmit` and
`TaskCreated` entries because their payloads were collected without being used.
[Installer](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/claudeHookInstaller.ts),
[event list](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/constants.ts).

The script reads per-server discovery records, skips dead PIDs and fans the raw
event out to every live local server using each server's bearer token. It falls
back to a legacy single-server file when the registry yields no targets. Each
POST goes to `127.0.0.1`, has a two-second timeout and fails quietly; the script
always exits zero. Ports and rotating server tokens do not require rewriting
Claude settings. Runtime adoption then limits which sessions appear to tracked
projects, unless Watch All Sessions is enabled. **Display/adoption scope does
not narrow collection:** the global hook has already delivered the payload to
all discovered servers.
[Hook script](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/hooks/claude-hook.ts),
[session scope](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/hookEventHandler.ts).

**Conflicts and removal.** Reinstall removes owned commands across all event
keys, then adds the current set. Removal filters individual handlers, preserving
foreign handlers even inside a shared matcher group. Unknown fields, junk
array elements and pre-existing empty event arrays survive. It refuses
unparseable JSON, a non-object hooks container (with null treated as absent on
install), and non-array values for events it needs to install. Non-array values
under unrelated events are left alone. It does not resolve semantic conflicts
such as another hook denying a tool or provider-level settings disabling hooks.
[Installer and removal](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/claudeHookInstaller.ts).

Before changing user content it creates a brand-specific, one-time backup with
exclusive creation; an existing backup must resolve to a regular file. Backup
failure aborts mutation. It avoids backing up settings containing only its own
generated configuration. Writes use a temporary file and rename, preserve an
existing file's POSIX mode and start fresh settings at `0600`. Immediately before
rename it checks the exact original bytes and retries on changes, up to three
attempts with 100 ms delays. This narrows lost-update risk but is not a lock or
atomic compare-and-swap; another write can still land between check and rename.
The temporary filename is fixed, so concurrent instances remain a consideration.
Uninstall surgically rewrites settings and retains the backup rather than
automatically restoring it. Errors identify whether install failed or entries
were left in place. [Persistence implementation](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/claudeHookInstaller.ts).

The extension registers `vscode:uninstall` to remove global hook entries using
plain Node. It leaves the shared script for standalone use and resets its own
hook configuration even if removal logs an error. CLI and extension share one
hook set: uninstalling the extension can remove entries standalone still needs;
a later consented standalone startup can reinstall them. This is shared cleanup,
not reference-counted ownership.
[Extension uninstall](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/adapters/vscode/uninstall.ts).

**Windows paths.** Filesystem paths use Node path helpers; commands quote the
absolute script path to support spaces. Hook identity examines the executed
script token, recognizes Node/`node.exe` interpreter paths, normalizes backslashes
and accepts drive-rooted paths. It uses bounded owned path suffixes, not arbitrary
substrings: a `.backup` suffix, comment, wrapper argument or similarly named
directory does not establish ownership. Relative script paths are not owned.
Identity folds case unconditionally, helping removal after Windows casing edits
but potentially deleting a distinct case-sensitive Linux file. It recognizes
legacy names and previous-home paths; symlink aliases are not resolved.
[Identity implementation](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/claudeHookInstaller.ts),
[identity and mutation tests](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/__tests__/claudeHookInstaller.test.ts).

Transcript discovery encodes non-alphanumeric path characters as dashes and
falls back to a case-insensitive project-directory lookup. A separate runtime
path-key helper resolves paths and lowercases on Windows only to avoid duplicate
session adoption. POSIX permission tests are skipped on Windows; these are not
evidence of Windows ACL preservation.
[Project discovery](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/providers/hook/claude/claude.ts),
[path keys](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/server/src/pathKey.ts).

## How we do it

- Explicit local `agentarium init` creates/reuses a random bearer token, writes
  hooks, then probes daemon health. It can install before the daemon starts and
  warns if no daemon or another version is running. `start` does not install.
  There is no browser install/uninstall action to token-gate today.
  [Commands](../../packages/cli/src/commands.ts), [CLI output](../../packages/cli/src/bin.ts).
- We target user-level settings and honor `CLAUDE_CONFIG_DIR`. Ten native HTTP
  hooks send directly to the configured loopback port, with a two-second timeout
  and the bearer token embedded in settings. `SessionStart` is deliberately absent
  because our implementation documents it as command-only; the adapter can map
  it if supplied independently. Changing port or token requires rerunning init.
  [Settings](../../packages/cli/src/settings.ts), [paths/token](../../packages/cli/src/paths.ts).
- Reinstall removes handlers with type `http` and an exact URL shape
  `http://127.0.0.1:<digits>/hooks/claude-code` across every event, then appends
  our handlers. Foreign handlers and mixed groups normally survive. Ownership
  ignores token, install provenance and any distinction between Agentarium
  homes. Invalid JSON and non-object top-level JSON are rejected, but blank
  files are treated as empty. Nested hook shapes receive weaker protection.
  [Ownership and merge](../../packages/cli/src/settings.ts).
- Init backs up an existing file once as `.agentarium-backup`, then writes a
  fixed `.agentarium-tmp` and renames it. There is no reread/concurrency guard,
  explicit settings/temp mode, backup validation or temp cleanup on failure.
  A second init after creating a fresh settings file can back up our own output.
  [Persistence](../../packages/cli/src/settings.ts).
- Uninstall removes matching handlers. It restores the original bytes only if
  parsed backup contents exactly equal the cleaned settings; otherwise it keeps
  later edits and the backup. With no backup and an empty result it deletes the
  settings file. This conditional restoration is useful. Restoration uses a
  direct copy rather than an atomic replacement; its broad catch can suppress
  restore/delete errors and fall through to a different result.
  [Uninstall](../../packages/cli/src/settings.ts).
- Uninstall removes hooks only; stopping the daemon, removing npm and deleting
  data are separate documented actions. HTTP hooks avoid Windows shell quoting
  and Node-on-PATH dependencies. Node path helpers handle settings locations;
  Room IDs normalize slashes and lowercase only on Windows. The pure adapter
  handles either path separator for summaries and returns payload `cwd` for Room
  resolution. All repositories feed the one global daemon, consistent with
  [ADR 0002](../adr/0002-one-global-daemon-with-rooms.md), not a collection filter.
  [Adapter](../../packages/adapters/src/claude-code.ts), [Rooms](../../packages/server/src/rooms.ts),
  [removal instructions](../../README.md).

Existing [settings tests](../../packages/cli/test/settings.test.ts) cover ordinary
hook preservation, repeated init, invalid JSON, conditional backup restoration
and later edits. [Lifecycle tests](../../packages/cli/test/lifecycle.test.ts)
use temporary configuration directories and cover daemon-aware CLI behavior.
They do not cover the main mutation risks below.

## Gaps: candidate phase 2 spec items

Severity describes observed implementation risk, not an upstream ticket label:
**High** means plausible user-config loss or weakened secret-file protection;
**Medium** means reliability, ownership or recovery risk; **Low** means a useful
clarification or future boundary. These are candidates, not committed scope.

| Candidate | Severity | Evidence and proposed acceptance criteria |
| --- | --- | --- |
| P2-IS-01: Refuse destructive nested-shape normalization | High | `withHooks` replaces a scalar/array `hooks` container and non-array values at installed events with new structures. Validate every field we must change before any settings or backup write; reject incompatible shapes with the exact path and leave original bytes unchanged. Preserve malformed values under unrelated events. Test null, strings, arrays and object-valued event fields explicitly. |
| P2-IS-02: Remove only fields changed by our removal | High | `withoutHooks` drops every pre-existing empty event array, even when no Agentarium handler exists; an empty hooks object also disappears. Uninstall can therefore modify or delete an unrelated settings file and report success. Preserve untouched empty containers, junk elements, matchers and extra fields; prune only containers emptied by removing owned handlers. A never-installed file must remain byte-for-byte unchanged. |
| P2-IS-03: Guard read-modify-write against concurrent writers | High | Atomic rename prevents torn output, but our stale read can overwrite another tool's new permission rules. Use unique, exclusively created temp files, reread immediately before commit, retry mutation on fresh contents within a bounded budget, and clean temps on failure. Apply to install, surgical removal, restoration and deletion. Inject edits during preparation and verify they survive or the operation refuses. Document the residual race with uncooperative writers. |
| P2-IS-04: Preserve settings and temporary-file access restrictions | High | Settings contain the bearer token; temporary output currently uses default creation permissions and replacing settings can relax a restrictive POSIX mode. Preserve existing mode, create fresh settings/temps restrictively, and protect backups. Define Windows ACL expectations separately and verify rename/restore behavior on Windows rather than equating `0600` with ACL security. Test restrictive umasks and failure cleanup. |
| P2-IS-05: Make backup provenance and restoration dependable | Medium | `existsSync` alone accepts an occupied backup path, backup creation is not exclusive, repeated fresh installs can back up our own hooks, and direct restore/catch-all fallback can mask I/O failures. Require a recoverable backup before changing user content; track fresh-file ownership without inferring it solely from missing backup. Preserve the first genuine user snapshot. Restore atomically only after semantic comparison and surface restore/cleanup failures accurately. Test directories, dangling links, unreadable/stale backups and repeated fresh init/uninstall cycles. |
| P2-IS-06: Specify ownership across alternate homes and edited hooks | Medium | The URL pattern claims any HTTP hook at our endpoint on any port, regardless of token or installing home; changing an owned URL to `localhost` leaves it unrecognized. Define ownership and supported migrations, using installation records or conservative matching compatible with Claude's schema. Preserve look-alikes; remove known old owned handlers across all event keys. Test mixed groups, manually changed URLs and two `AGENTARIUM_HOME` values sharing Claude settings. Do not use the current token alone, since rotation must still allow cleanup. |
| P2-IS-07: Make global collection scope explicit and inspectable | Medium | Room grouping is a display partition, and global hooks submit raw payloads from all projects before adapter summarization. Provide a preview of target settings path, event set, raw data categories, token placement, backup and undo command. Keep explicit local init as authorization; an extra confirmation dialog is not necessary. If opt-in repository collection restrictions are desired, specify where enforcement happens and test out-of-scope payloads, without replacing the global-daemon architecture. |
| P2-IS-08: Validate credentials and report installation health | Medium | Normal init obtains a token, but exported `installHooks` accepts an empty token; token read errors fall through to recreation. Health probing happens after settings mutation and does not establish token agreement with the running daemon. Reject empty/invalid credentials and unreadable existing token files rather than silently rotating; diagnose configured port/token mismatch. Report absent, partial, complete and unreadable hook state distinctly, plus hook removal remaining after failed mutation. Test without printing secrets. |
| P2-IS-09: Verify Windows install/uninstall as a complete lifecycle | Medium | Our HTTP approach avoids script quoting, but filesystem replacement, paths containing spaces/non-ASCII characters, alternate `CLAUDE_CONFIG_DIR`, drive casing and file locks still need focused coverage. Use an isolated Windows home/config and real init/uninstall, verify foreign-hook preservation and repeated operation, simulate replacement failure and check truthful errors/no config loss. Test UNC paths where supported and keep real user settings untouched. |
| P2-IS-10: Preserve a privileged boundary for any future UI installer | Low, future-only | No browser mutation endpoint exists today, so lack of Pixel Agents' consent dialog is not a current authorization flaw. If added, require a nonempty verified token plus an explicit install/removal action; reject tokenless/invalid requests before disk writes. Test forged WebSocket messages and forwarded loopback traffic. Do not treat Origin/Host or client address as authorization. |

The first implementation slice should address P2-IS-01 through P2-IS-04: these
protect existing user configuration independently of any UI redesign. Backup
and ownership work should follow before adding further installation surfaces.

## What we should not copy

- No source, tests, consent wording, sprites, layouts or other art. Pixel Agents'
  [source license](https://github.com/pixel-agents-hq/pixel-agents/blob/d1e007a9fdf3003c252d2973abe1999ae59aec33/LICENSE)
  is MIT, but our ADR chooses independent implementation and its third-party art
  terms are not established by that license. Use independently written specs
  and tests for the safety properties described here.
- Do not import its per-server fan-out registry or per-project adoption model
  wholesale. One global daemon and repository Rooms are our accepted design.
  Dynamic discovery is only an idea to evaluate if stale ports/tokens become a
  demonstrated problem; it adds shared-file and delivery complexity.
- Do not replace native HTTP hooks with a Node command shim solely to resemble
  upstream. A shim adds per-event process startup, interpreter resolution and
  shell/path handling. A future command hook for `SessionStart` needs its own
  compatibility decision and Windows verification.
- Do not copy unconditional case folding or suffix-based ownership without
  examining platform and provenance. Upstream acknowledges Linux false
  positives, leaves symlink aliases undetected and has shared CLI/extension
  cleanup implications. Our endpoint ownership needs its own rules.
- Do not silently infer authorization for a larger event set from any partial
  old installation, hardcode `~/.claude` while ignoring the configured directory,
  or claim global payload collection becomes project-local because the display
  filters it. Preserve our configurable path support.
- Do not adopt tokenless viewing, automatic backup restoration, or automatic npm
  uninstall scripts by analogy. Our view already requires authentication, our
  conditional backup restore protects later edits, and package removal is
  separate from intentional hook removal. Evaluate each behavior on its own.
- Do not promise race-free updates, shell-proof quoting or Windows ACL guarantees
  from upstream's implementation. Learn the guarded-write and conservative
  ownership principles, then specify and verify our own platform guarantees.

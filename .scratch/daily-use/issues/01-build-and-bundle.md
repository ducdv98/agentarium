# Build and bundle `@agentarium/cli`

Status: ready-for-agent
Type: task
Blocked by: none

Add a build step that produces one publishable package, `@agentarium/cli` (ADR 0005): CLI, daemon, adapters and core bundled to JavaScript, plus the built `ui-web` assets the daemon serves. The `agentarium` command points at built output, not `src/bin.ts`, and the detached daemon starts from built output rather than through `tsx`. Workspace packages stay `private`. Keep the MVP constraint of no native modules or shell scripts in install or hook paths.

Acceptance:
- `npm pack` produces a tarball. Installing it globally in a clean directory makes `agentarium init`, `start`, `stop` and `uninstall` work on Windows, macOS and Linux (checked in CI).
- The packed daemon serves the UI and accepts hook events with no dev dependencies installed.
- `tsx` is not a runtime dependency of the published package.

## Comments

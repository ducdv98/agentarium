# MIT licence and README

Status: resolved
Type: task
Blocked by: none

Add an MIT `LICENSE` (copyright Duc Dao) at the repo root and include it in the published package. Write a short `README.md` covering:
- what Agentarium is (triage first)
- install (`npx @agentarium/cli init`, or install globally)
- the commands `init`, `start`, `stop`, `uninstall`
- security notes: localhost only, Host/Origin checks, and the bearer token stored in plain text in the Claude Code settings file
- upgrading: `stop`, then `start`, since `start` refuses a daemon of a different version
- removing: run `agentarium uninstall` before uninstalling the package. Leftover hooks are harmless but stay in the settings file.

Acceptance: both files present, the README matches actual CLI behaviour, and no theme words are used for core concepts.

## Comments

- 2026-10-09: MIT `LICENSE` (Duc Dao) and `README.md` at the repo root. `packages/cli/build.mjs` copies both into the package directory (gitignored copies) so npm publishes them; `package.json` sets `"license": "MIT"`. `smoke-pack.mjs` now checks the tarball contains `LICENSE` and `README.md`. README claims checked against `packages/cli/src` and `packages/server/src` by a Codex spec review; its two findings (follow-room wording, backup-restore condition) are fixed. Typecheck, the full test suite and `smoke-pack` pass locally on Windows. Resolved.

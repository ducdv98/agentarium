# MIT licence and README

Status: ready-for-agent
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

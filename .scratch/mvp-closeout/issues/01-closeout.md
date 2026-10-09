# Close out the MVP slice

Status: ready-for-human
Type: task
Blocked by: none

Finish the MVP slice (`.scratch/mvp-slice/`) before Phase 1 (`.scratch/daily-use/`) starts. The log this ticket produces decides which `needs-triage` issues in Phase 1 get promoted.

Steps:
- Extend the CI matrix to Node 22 and 24 on Windows, macOS and Linux (6 jobs), push the unpushed commits, and get all jobs green.
- Run the payload logger (`spikes/payload-logger.mjs`) in a real interactive Claude Code session. Capture `Notification` of type `idle_prompt` (leave a prompt idle for about 60 s) and `elicitation_dialog`. Sanitize them into `spikes/fixtures/claude-code/`, update `docs/research/hook-payloads.md`, and add reducer tests confirming that the Needs-input flag and idle state handle them as the MVP spec says.
- Use Agentarium for about 3 days, including at least one day of real multi-agent work with the page open.
- Log every moment the view was wrong, late or useless under `## Comments`, one bullet each: what you saw, what was true, and how much it hurt triage.

Acceptance:
- CI green on all 6 jobs.
- `idle_prompt` and `elicitation_dialog` fixtures committed, with passing reducer tests.
- The usage log exists, even if it is empty, and each entry is either linked to a Phase 1 issue or dismissed.

## Comments

- 2026-10-09 (agent): CI matrix is now Node 22 and 24 on 3 OSes (`3bd158b`), and all commits are pushed. Locally on Windows with Node 24, typecheck passes and all 97 tests pass; GitHub results not yet checked (private repo, no `gh` here). The adapter already maps `Notification` `idle_prompt` to stop (idle, no flag) and `elicitation_dialog` to needs-input (`packages/adapters/src/claude-code.ts:158`). It still needs real fixtures to confirm the payload shape. Remaining steps are for a human: the interactive capture, about 3 days of use, and the usage log.
- 2026-10-09 (agent): GitHub Actions is blocked: "your account is locked due to a billing issue", which also blocks the now-public repo. Added `pnpm verify:all` (`scripts/verify-all.mjs`) as a local stand-in. It passes on Windows (Node 22.23.3 and 24.18.0) and Linux in Docker (Node 22.23.3 and 24.21.0): all 7 packages typecheck, test and build. macOS stays unverified until Actions is unlocked, so the CI acceptance item remains open.
- 2026-10-09 (agent): After the billing fix, run 37929563594 (`a46bd88`): macOS on Node 22 and 24 passed. The Ubuntu and Windows jobs were still refused with the billing lock message. Together with `verify:all` this covers all 6 combinations, but the item stays open until one CI run is fully green. Warning seen: `actions/checkout@v4`, `actions/setup-node@v4` and `pnpm/action-setup@v4` target the deprecated Node 20.
- 2026-10-09 (agent): Run 37929757952: all 6 jobs green. CI acceptance item done. Remaining: the interactive capture and the usage log.

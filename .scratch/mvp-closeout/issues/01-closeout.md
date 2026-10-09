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

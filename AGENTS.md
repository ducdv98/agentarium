## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.


## Agent delegation policy

When running Matt Pocock engineering workflows, Claude is the orchestrator. Codex is consider as executor or sub-agent to help speed up implementation and review work. Claude owns the final decision and is responsible for the quality of the work.

Note: Codex usually hangs and did not produce any output. Check its progress after a 2 minutes. If Codex is stuck, you can cancel the current task and re-run it.

### Research

Deligate research tasks to Codex. Claude can self-invoke to perform research work when Codex is unavailable or stuck.

Use:

    codex --dangerously-bypass-approvals-and-sandbox exec "<research instruction prompt>"

### /implement

For each ticket:

1. Claude reads the ticket/spec and determines the required implementation.
2. Delegate implementation to Codex CLI.
3. Codex modifies the working tree and runs relevant tests.
4. Claude verifies the result and acceptance criteria.
5. Continue the normal `/implement` workflow.

Use:

    codex --dangerously-bypass-approvals-and-sandbox exec "<implementation prompt>"

Codex must not commit unless explicitly instructed.

Note: Some specific cases, Claude can work in parallel with Codex to speed up the implementation:
- Codex hit the quota limit and cannot continue, Claude can continue the implementation.
- Tasks can be done in parallel, Claude can work on one task while Codex works on another task.

### /code-review

When `/implement` reaches the code-review phase, delegate the actual review work
to Codex instead of performing the review directly with Claude sub-agents.

The review must preserve Matt Pocock's two review axes:

1. Standards review
   - Compare the diff against repository coding standards.
   - Identify maintainability/design/code-quality issues.
   - Treat code smells as judgement calls rather than automatic violations.

2. Spec review
   - Compare the implementation against the originating ticket/spec.
   - Identify missing requirements, incorrect behavior, and scope deviations.

Use independent Codex invocations for the two axes where practical.

Example:

    codex --dangerously-bypass-approvals-and-sandbox exec "<standards review prompt>"

    codex --dangerously-bypass-approvals-and-sandbox exec "<spec review prompt>"

Claude then:
- collects both reviews
- evaluates the findings
- delegates fixes to Codex when appropriate
- reruns review if necessary
- commits only after the implementation is acceptable

Claude owns orchestration and the final decision.
Codex performs implementation and review work. Claude can self-invoke to perform implementation and review work when Codex is unavailable or stuck.

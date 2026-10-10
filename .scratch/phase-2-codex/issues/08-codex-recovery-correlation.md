# 08: Codex recovery and correlation

**What to build:** After the daemon restarts, Codex sessions re-appear from their rollout metadata, and OTel outcomes are matched to the right agent. Replayed history does not appear as fresh current work.

**Blocked by:** 06

**Status:** resolved

- [x] After a daemon restart, running Codex sessions re-appear with the right identity
- [x] Replayed history is not shown as current activity
- [x] OTel outcomes are attached to the agent whose conversation ID matches
- [x] Hook-only sessions still work when no rollout metadata exists

**Known limits:** after a restart, an active root thread that the event log does not know appears only on its next event, because Agentarium does not invent activity for it. OTel is opt-in: the user adds the `[otel]` block to `~/.codex/config.toml` themselves. Only OTel failures are used. Rollout lookups scan the last 14 day directories plus `archived_sessions`.

## Comments

**Agent decisions (2026-10-10), please review:**
- **Restart:** the daemon rebuilds rooms from its own event log as before, so Codex agents come back with the same identity. The live connection then resumes loaded threads. It sends `spawn` (observed, from `parentThreadId`) for sub-agents and `stop` for idle threads. It never sends `session_start` or any activity, and it ignores completions of items that started before the resume.
- **Rollout metadata:** only the first line (`session_meta`) of a rollout is read, capped at 256 KB. It names the immediate parent for a sub-agent the adapter has not seen, for example after a restart, and turns `inferred` links into `observed` ones at `SubagentStop` (through `agent_transcript_path`). Verified with a real `codex exec`: the child's link went from inferred to observed. Hook-only sessions with no rollout keep working.
- **OTel:** `POST /otel/v1/logs` takes OTLP JSON only (415 otherwise) and needs the bearer token. Only `codex.tool_result success:"false"` and denied `codex.tool_decision` records are used. They become `tool_end ok:false`, matched to the agent by `conversation.id` (thread id) and to the call by `call_id` (= `tool_use_id`). OTel `success:"true"` is ignored, because it means the tool call ran, not that the command succeeded (`ls /nope` reported true). Because OTel is batched, a failure applies only while the call is still pending, so a late record cannot turn an idle agent into blocked.
- **Agentarium does not edit `~/.codex/config.toml`:** the README shows the snippet, which puts the token in that file in plain text. I chose this so `init` never rewrites the user's TOML config. Say so if you want `init` to offer it.
- **Kept out on purpose:** suppressing a hook `SessionStart` for an agent that already exists. A real start or resume should still reset the agent to idle.

**Code review (2026-10-10):** after the standards and spec reviews, restored Codex sub-agents are now ended by the root's `SessionEnd`. A restored world is timed out once at startup, before it is served. The thread registry merges known locations instead of overwriting them. App-server calls time out after 10 seconds, and the socket symlink is reused across reconnects.

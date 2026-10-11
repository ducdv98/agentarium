# 04: Prompt start in the Label

**What to build:** The Label becomes the branch plus the start of the Agent's first prompt, so parallel Agents on one branch can be told apart. The `prompt` Event gains an optional field with the prompt's first characters, truncated in the Adapter before the Event reaches the Daemon. Both the Claude Code and Codex Adapters write it. A config switch turns it off, and then Adapters leave the field out (ADR 0008). The full prompt never enters an Event.

**Blocked by:** 03

**Status:** needs-triage. Stays here until the usage week ends; entries in `.scratch/daily-use/usage-log.md` can change it (spec, Gate).

- [ ] The Claude Code and Codex Adapters write the truncated prompt start on `prompt` Events; the full prompt is never in the Event, the event log or a WebSocket message
- [ ] The truncation length is fixed in one place and covered by an Adapter test with a long, multi-line prompt
- [ ] With the switch off, the field is absent from new Events and the Label falls back to the branch
- [ ] The Label uses the Agent's first prompt in the session, and a replay gives the same Label
- [ ] Events without the field (older logs) still load and replay
- [ ] The README says what the field records and how to switch it off

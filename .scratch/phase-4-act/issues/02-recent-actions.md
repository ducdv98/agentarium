# 02: Recent actions in the Inspector

**What to build:** The Inspector lists the selected Agent's Recent actions: its last 5 tool calls, each with tool, Action category, summary, start, end and whether it succeeded. The reducer keeps them on each Agent, so a replay reproduces them. They stay on that Agent and are never rolled up to its Lead. This changes `WorldState` but not the AgentEvent schema.

**Blocked by:** 01

**Status:** needs-triage. Stays here until the usage week ends; entries in `.scratch/daily-use/usage-log.md` can change it (spec, Gate).

- [ ] The reducer keeps at most 5 Recent actions per Agent, newest first, from `tool_start` and `tool_end`
- [ ] A call still running shows as running; one that ended shows its end time and ok or failed
- [ ] A Member's tool calls never appear in its Lead's Recent actions
- [ ] Replaying the event log gives the same Recent actions as the live run (a reducer test)
- [ ] The Inspector lists them with relative times and the summary truncated to one line

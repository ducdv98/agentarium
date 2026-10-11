# 05: Resume command

**What to build:** For an Agent that is idle or done, the Inspector shows a resume command the user can copy and paste into a terminal to get back to that session, in the Agent's own directory, for each provider. A live Agent never gets one, because resuming it would start a second process on the same session. This is how "go to the Agent" works without leaving the browser (ADR 0005).

**Blocked by:** 01

**Status:** needs-triage. Stays here until the usage week ends; entries in `.scratch/daily-use/usage-log.md` can change it (spec, Gate).

- [ ] An idle or done root Agent shows a copyable command for its provider (Claude Code and Codex) that changes to its directory and resumes its session
- [ ] A working, waiting or blocked Agent shows no command, and the Inspector says why
- [ ] A Member shows no command of its own and points to its root Agent
- [ ] The command quotes paths so a directory with spaces works on Windows, macOS and Linux shells
- [ ] Copying gives visible feedback; the page never runs the command itself

# 03: Branch in the Label

**What to build:** Each Agent gets a Label so the user can tell which terminal it is. This ticket adds its first part: the branch, or the worktree when the checkout is a worktree. The Daemon works it out from the Agent's `cwd` by reading `.git` and `HEAD` directly, with no git subprocess, the way it works out the Room. It re-reads it on each `session_start` and `prompt`, and keeps it outside the AgentEvent schema. The Inspector and the roster show the Label.

**Blocked by:** 01

**Status:** needs-triage. Stays here until the usage week ends; entries in `.scratch/daily-use/usage-log.md` can change it (spec, Gate).

- [ ] A normal checkout gives its branch name; a detached HEAD gives a short commit id
- [ ] A linked worktree (`.git` is a file) gives that worktree's branch, and the Agent stays in the shared Room
- [ ] A `cwd` outside any repository gives no branch, and the Label falls back to something short and readable instead of failing
- [ ] Switching branch mid-session shows up after the next `session_start` or `prompt`
- [ ] No AgentEvent changes shape, and the event log has no branch field
- [ ] The Inspector and the roster show the Label

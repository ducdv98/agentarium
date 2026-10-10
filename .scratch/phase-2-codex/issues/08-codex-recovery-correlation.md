# 08: Codex recovery and correlation

**What to build:** After the daemon restarts, Codex sessions re-appear from their rollout metadata, and OTel outcomes are matched to the right agent. Replayed history does not appear as fresh current work.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] After a daemon restart, running Codex sessions re-appear with the right identity
- [ ] Replayed history is not shown as current activity
- [ ] OTel outcomes are attached to the agent whose conversation ID matches
- [ ] Hook-only sessions still work when no rollout metadata exists

# 06: Needs-input cue

**What to build:** One opt-in toggle turns on an in-page chime and an optional desktop notification. It fires once when the Needs-input flag turns on for any Agent in any Room, not just the Followed room. It's debounced, so a burst of Sub-agents rings once. When the Daemon can't be reached, the toggle shows it, so silence is never taken for no news. It's opt-in because browsers block audio until the user interacts with the page.

**Blocked by:** None (can start immediately)

**Status:** needs-triage. Stays here until the usage week ends; entries in `.scratch/daily-use/usage-log.md` can change it (spec, Gate).

- [ ] The cue is off by default; turning it on is the interaction that unlocks audio, and the choice is remembered in this browser
- [ ] The desktop notification is a separate opt-in that asks for permission, and the chime still works if permission is denied
- [ ] A Room going from no Agents needing the user to some rings once; several Agents turning on within the debounce window ring once
- [ ] A Room outside the Followed room rings too
- [ ] The first state after loading or reconnecting does not ring for Agents that were already waiting
- [ ] While the Daemon can't be reached, the toggle shows that the cue is not listening
- [ ] If the usage week or a test shows the cue arriving late, daily-use issue 08 (stale backpressured client) joins this phase

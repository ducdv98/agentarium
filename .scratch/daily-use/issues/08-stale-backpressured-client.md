# A backpressured client stays stale until the next flush

Status: wontfix
Type: task
Blocked by: none

When a WebSocket client is backpressured, the daemon skips it and it stays stale until the next coalesced flush. In a quiet room that could leave a Needs-input flag unshown. Promote only if `usage-log.md`, or a load generator run, shows a stale view.

## Comments

- Dismissed (wontfix) during `/implement 08`: the promotion gate is not met. `usage-log.md` has no entries, and no load generator run is recorded showing a stale client. A single browser snapshot of the running app (session view, no busy period) did not test staleness either. Reopen by setting `Status: needs-triage` if a usage-log entry or a loadgen run shows a stale view.

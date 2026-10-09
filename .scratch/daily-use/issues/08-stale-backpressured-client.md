# A backpressured client stays stale until the next flush

Status: needs-triage
Type: task
Blocked by: none

When a WebSocket client is backpressured, the daemon skips it and it stays stale until the next coalesced flush. In a quiet room that could leave a Needs-input flag unshown. Promote only if `usage-log.md`, or a load generator run, shows a stale view.

## Comments

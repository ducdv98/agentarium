# Phase 2: Codex adapter and install safety

Goal: Agentarium shows Codex CLI sessions in the same room view as Claude Code, and the hook install no longer risks the user's existing settings. Terms follow `CONTEXT.md`; decisions are in `docs/adr/`. Follows `.scratch/daily-use/spec.md` (Phase 1, closing after about two weeks of real use). Research: `docs/research/codex-event-mapping.md` and `docs/research/install-safety.md`. Real usage is logged in `.scratch/daily-use/usage-log.md`, as in Phase 1.

## Scope

- A Codex adapter for the signals the research recommends first: trusted lifecycle and tool hooks, with live app-server approval and tool outcomes where a supported client connection exists, rollout metadata for identity and recovery, and OTel for correlated outcomes and diagnostics.
- Install-safety items P2-IS-01 through P2-IS-04 from `install-safety.md`: refuse destructive nested-shape normalization, remove only fields we changed, guard read-modify-write against concurrent writers, and preserve settings and temp-file access restrictions. The research says these protect user configuration independently of any UI work, so they form the first implementation slice.
- Codex event gaps are recorded, not changed. The model stays at the nine ADR 0004 categories until a live Codex capture confirms a gap matters.

Out of scope for this phase:
- Changes to the AgentEvent schema, including a neutral resume/input-resolved event and a standalone error event (see Decisions).
- Install-safety items P2-IS-05 through P2-IS-10. They follow after the first slice, as the research recommends.
- Rate-limit health bars, transcript fallback, and a flag-in-UI feature for usage-log entries. Each waits for usage-log evidence (see Decisions).
- Auto-start on login, multiple machines or a network relay, the isometric theme, the all-rooms home page, and Pixel Agents' scores and interactive furniture.

## Decisions (from grilling, 2026-10-10)

- Phase 2 scope is gated by the usage log, the same way Phase 1's was. Anything beyond the fixed list needs usage-log evidence first.
- Ideas from Pixel Agents are taken, not its code or art (ADR 0001). Its roadmap item "any agent in any environment" is the Codex adapter. Its hook install and removal behavior is the basis for the install-safety review.
- Localhost and one machine only for this phase.
- Phase 1 item 07 (MCP tools mapped by verb) was built before a usage-log entry justified it. Its promotion is recorded as waived. No backfill entry is written.
- Usage-log entries stay manual. A flag-in-UI feature or automatic mismatch detection is deferred until manual entries show the need.
- Only the top four install-safety items go into this phase, because they protect user settings and the Codex hook install writes to the same settings files.
- Codex event gaps are recorded and confirmed with a live Codex capture before any schema change. Capture fixtures are part of the Codex adapter work.
- Pixel Agents studies are written up in `docs/research/` before a phase spec relies on them.

## Open questions (carried from research)

Pinned from `codex-event-mapping.md`. They must be answered by live captures before the adapter is built:

1. Which minimum released Codex version includes the inspected hooks and session metadata? Pin a release and record the CLI version with fixtures.
2. For root, child and grandchild sessions, does a hook's `session_id` name the immediate parent or the root?
3. Which failure and denial paths emit `PostToolUse`, and which response fields establish success?
4. Does every real user-permission path emit a usable hook?
5. Can Agentarium obtain live approval notifications from an already-running CLI without owning its client connection? If not, how much hook-only fidelity is acceptable for triage?
6. Should the event union gain a neutral resume/input-resolved event and a standalone error event? Deciding this is outside this phase's scope.

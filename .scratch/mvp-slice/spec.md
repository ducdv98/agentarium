# MVP slice: Claude Code to a live room

Goal: triage first. The v1 success test is "who needs me?" answered at a glance for Claude Code agents on one machine. Terms follow `CONTEXT.md`; decisions are in `docs/adr/0001-0004`.

## Scope

- One daemon, Claude Code only, one Room visible in the UI (rooms exist in the data model).
- Append-only JSON-lines log per room, pure reducer, versioned Events.
- Identity is machine : provider : session : agent from day 0; `schema_version` on every Event.
- Dot-grid renderer, doubling as the theme leak check. Isometric art and the Pixi-versus-Canvas spike come after the core exists.
- Out of scope: other providers, themes beyond dot-grid, 3D, accounts, cloud sync, multi-room home page.

## Decisions (from grilling)

- Unknown or non-git `cwd` goes to a single "unassigned" Room.
- Idle after 30 s without events, only when no tool call is pending. Lost after 10 min without events and no stop observed, or after 2 h for an agent waiting on the user (post-MVP, 2026-10-09: a question left unanswered for 704 s had dropped from the scene). All configurable defaults.
- A pending permission request or question raises the Needs-input flag. `idle_prompt` sets state idle with no flag.
- Fixed uncommon default port, env-var override; `init` writes the real port into hook URLs. `start` refuses on a daemon of a different version, with a `stop` hint.
- Action categories are frozen only after real payloads are seen (ticket 01).
- Hooks must be non-blocking: short explicit timeout, never exit 2, never return decision JSON.
- Windows, macOS, Linux CI from the first commit; no shell scripts or native modules in install or hook paths.
- (Post-MVP, 2026-10-09) The UI shows one Followed room at a time. It switches on its own to the room that needs the user, unless the user has pinned a room. This replaces "one Room visible".

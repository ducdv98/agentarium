# Phase 4: Act on what you see

Goal: once the view shows that an Agent needs the user, the user can find that Agent and reach it without reading terminals. Select an Agent in the scene to open its Inspector. A cue sounds when any Room needs the user. The Overview lists every Room for triage. Terms follow `CONTEXT.md`. Decisions are in `docs/adr/`, especially ADR 0001 (Pixel Agents is a feature reference only), ADR 0003 (pure reducer), ADR 0005 (browser UI, one package) and ADR 0008 (prompt text in Events).

Reference: Pixel Agents already lets you click a character to reach its session and plays a cue when one needs you (`docs/research/prior-art.md`). This phase covers that ground, built in our own way and with none of its code or art.

## Gate

- Phase 3 issue 11 is closed: the owner has checked a real Codex session and a real waiting prompt in the office.
- Daily-use issue 09 (Glitches) has landed, so the Daemon records wrong or late moments during the week.
- After that, about one week of real use of the office scene, logged in `.scratch/daily-use/usage-log.md`. The usage-log gate is back for this phase, because it changes how the user triages. Issues stay `needs-triage` until the week ends, and the log entries can change them.

## Scope

- **Selection:** the `Renderer` interface gains `onSelect(agentKey)`. Every Renderer, dot-grid included, passes a hit-test case added to `test/renderer-contract.ts`. The roster selects too, which gives a keyboard path.
- **Inspector:** shows the selected Agent's State, Action category, tool, summary, Permission mode, time in its current State, Label and Recent actions. A Lead links to its Members.
- **Recent actions:** the reducer keeps the last 5 tool calls for each Agent: tool, category, summary, start, end and ok. They stay on that Agent and never roll up to its Lead. This changes `WorldState` but not the AgentEvent schema.
- **Label:** the branch or worktree plus the start of the first prompt.
  - The branch is worked out by the Daemon from `cwd` by reading `.git` and `HEAD` (no git subprocess), like the Room. It's re-read on each `session_start` and `prompt`, and it lives outside the AgentEvent schema.
  - The prompt start is a new optional, truncated field on the `prompt` Event, written by each Adapter. A config switch leaves it out (ADR 0008).
- **Resume command:** a copyable resume command in the Inspector, only for Agents that are idle or done. A live Agent never gets one, because resuming it would start a second process on the same session.
- **Cue:** one opt-in toggle turns on an in-page chime and an optional desktop notification.
  - It fires once when the Needs-input flag turns on for any Agent in any Room, debounced so a burst of sub-agents rings once.
  - When the Daemon can't be reached, the toggle shows it, so silence is never mistaken for no news.
- **Overview:** Rooms built from `RoomSummary`, ordered by Needs-input first and then by last activity. Each is named by its repo folder, with the full path on hover. Choosing one pins it as the Followed room.
  - Auto-follow acts only in the scene view and never takes the user out of the Overview. There, a Room that needs the user moves to the top and is highlighted.
  - The page still opens on the scene.
- **Conditional:** daily-use issue 08 (stale backpressured client) joins this phase if the usage week or a test shows the cue arriving late.

Out of scope for this phase:
- A transcript tail in the Inspector. Reading transcripts on demand is a separate decision with its own privacy questions.
- Focusing an OS terminal window.
- Drawing delegation and handoffs, Relationships, Groups or topologies (likely Phase 5).
- More providers (Gemini CLI, Cursor, OTel), multiple machines, auto-start on login, the 3D Renderer.
- Install-safety P2-IS-05 to P2-IS-10, and daily-use issue 06. Both stay `needs-triage`.
- Full prompt text anywhere, and any change to the nine action categories.

## Decisions (from grilling, 2026-10-11)

- **Act on what you see before anything else.** Triage is the product's main job, and a view you can see but can't act on stops halfway. Pixel Agents is ahead here today. Orchestration visuals are our differentiator and come next.
- **The browser stays the only surface** (ADR 0005). "Go to the Agent" means a Label you can recognise, plus a resume command when it's safe. It doesn't mean a VS Code extension or OS window control.
- **The Inspector reads `WorldState` only.** Recent actions come from the reducer, so a replay reproduces them.
- **Prompt text is optional, truncated in the Adapter and can be switched off** (ADR 0008).
- **The Overview is a list, not live miniature scenes.** Miniatures would multiply the cost of Pixi rendering, and nothing can be read at thumbnail size.
- **The cue covers every Room** and is opt-in, because browsers block audio until the user interacts with the page.

## Order

Issues are written after the usage week. Expected shape: selection contract first, then Recent actions in the reducer. Label, Inspector, cue and Overview follow and can run in parallel where their files don't overlap.

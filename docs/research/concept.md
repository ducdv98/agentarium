# Concept

Note: the office is the default theme, not the only one. Office words in this
doc (desk, department, manager) are theme vocabulary; core terms are in
[CONTEXT.md](../../CONTEXT.md) and swappable scenes are in [themes.md](themes.md).

A room where each agent (Claude Code session, subagent, Codex run, ...) is a
character with a stable face, body and outfit. Agent state shows up as visible
behavior instead of log lines.

## State to visual mapping

| Agent state | What you see |
|---|---|
| Thinking / generating | Sitting at a desk, chin on hand, thought bubble |
| Reading files / searching | Walking to a bookshelf, flipping through papers |
| Editing code / writing | Typing fast, screen glowing |
| Running tests / shell | Standing at a "machine", watching a progress light |
| Waiting on the user (permission/question) | Hand raised, or standing at the user's desk |
| Blocked / errored | Head in hands, red light over the desk |
| Delegating to a subagent | Walks over and hands a folder to another character |
| Idle / done | Leaning back, coffee, or leaves the room |

## Why it is worth building

- Parallel agents are hard to track in terminals; most people cannot tell which
  of several sessions is stuck.
- A glanceable ambient view works like a wall monitor: "raised hand" means the
  user is needed, with nothing to read.
- Easy to demo and share.

## Design choices

1. **Appearance is identity.** Generate a stable face/body/outfit per agent from
   a seed (agent name or role). Outfit can encode role (lab coat = reviewer,
   hoodie = implementer, suit = orchestrator).
2. **Rendering.** Start 2D stylized (sprites or layered SVG/Canvas). Move to 3D
   (Three.js / React Three Fiber, Mixamo animations) only if 2D proves out.
   Avoid photorealism: uncanny valley and high cost.
3. **Room as information.** Desks map to repo or task. Walking between desks
   shows handoffs. A wall board shows tokens, cost, elapsed time. Clicking a
   character shows the transcript or current command.

## MVP (thin vertical slice)

- Scope: one daemon, Claude Code only, one room visible, JSON-lines log, pure reducer. `machine_id`, `schema_version` and the room key are in the schema from day 0. Not sized in days.
- Local daemon that receives events over WebSocket.
- Browser page with a 2D room, 4-5 reusable characters, about 6 states.
- One-line installer that configures hooks.
- Out of scope: accounts, cloud sync, 3D, customization.

## Later

- Replay a past session as a "movie".
- Team view: everyone's agents in one office.
- Sound cues (bell when an agent needs the user).
- Personality traits derived from behavior.

## Risks

- Novelty fades unless it is useful for triage ("who needs me?").
- Event semantics differ per tool; adapters are ongoing maintenance.
- Past roughly 10 characters the room gets cluttered; group by project or zoom.

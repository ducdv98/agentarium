# Stack decisions

Research date: 2026-10-08. One table of the technology choices, their status
and the evidence. Details are in [architecture.md](architecture.md) and
[rendering.md](rendering.md). Prior art is in [prior-art.md](prior-art.md).

Status: **decided** (project owner), **proposed** (recommended, not locked),
**open** (needs a decision or a spike).

| Area | Choice | Status | Evidence / note |
|---|---|---|---|
| Language | TypeScript | Proposed | Shared reducer and types between daemon and browser |
| Runtime | Node.js current LTS | Proposed | Cross-platform; Pixel Agents requires Node 20+ |
| Monorepo | pnpm workspace | Proposed | Package boundaries in architecture.md |
| Daemon topology | One global daemon, rooms keyed by git root | Proposed | Hooks are configured per file, not per process |
| Server | HTTP + WebSocket in one process; Fastify is a candidate | Open | Pixel Agents uses Fastify |
| Event model | Append-only log + pure reducer, versioned schema | Proposed | Replay, resync, tests, future relay |
| Storage | JSON-lines behind an interface | Proposed | `node:sqlite` is Stability 1.2 (release candidate) as of Node v26.x |
| Hooks transport | Claude Code `http` hook; Node shim for other providers | Proposed | HTTP hook failure is non-blocking (verified) |
| Hook scope | User-level, with project-level opt-in | Proposed | Idempotent `init`, backup, `uninstall` |
| UI framework | React with Vite, static SPA | Proposed | Next.js static export is the alternative; Pixel Agents uses React 19 + Vite |
| UI state | Zustand fed by WebSocket patches | Proposed | Keeps canvas out of React render loop |
| Routing / styling | React Router or TanStack Router; Tailwind | Open | |
| 2D renderer | PixiJS v8 behind a `Renderer` interface | Proposed | Confirm with spike; Pixel Agents uses Canvas 2D |
| Render API | WebGL default, WebGPU opt-in | Proposed | Pixi docs list WebGPU as experimental |
| Camera / art | Hand-drawn isometric sprites | **Decided** | |
| Characters | Layered, tint-colored paper-doll, 2 drawn directions + mirror | Proposed | Stations fix facing to limit directional art |
| Animation | Frame-based sprite sheets | Proposed | Skeletal (Spine) deferred; license applies |
| 3D | Later, separate renderer (Three.js likely) | **Decided** (timing) | Engine not chosen |
| Packaging | npm global install / `npx` | Proposed | Node SEA possible later; needs per-OS builds and signing |
| Platforms | Windows, macOS, Linux | **Decided** | CI matrix from day 0 |
| Security | 127.0.0.1, token, Host/Origin checks | Proposed | Same model as Pixel Agents |
| Scalability | Seams at day 0 (log, reducer, bus, protocol, `machine_id`) | **Decided** (goal) | Details in architecture.md |

## Strategic decision pending

Decided: build independently (ADR 0001). Pixel Agents already implements a close version of this idea (see
[prior-art.md](prior-art.md)). The differentiators in this repo's notes
are isometric hand-drawn art, swappable themes, a relationship-graph model,
multi-provider schema, and a global multi-room daemon.

## Research gaps

- Official Codex and Cursor docs were unreachable from the research sandbox;
  their rows in [event-sources.md](event-sources.md) are from search summaries.
- Hook failure behavior is verified only for Claude Code.
- Pixi batching behavior with tint and `AnimatedSprite` is inferred, not
  measured.
- Spine license terms and Rive plugin maintenance were not read in full.
- Pixi WebGPU status was gathered from secondary sources; the live docs and the
  current Pixi version were not read.
- Only one prior-art project was found; the search was narrow.
- No performance numbers exist yet for this project; all targets are proposals.

## Suggested next steps

1. ~~Decide build / contribute / fork~~ (done, ADR 0001).
2. Dump real Claude Code hook payloads, then write the adapter mapper and freeze the action categories.
3. Run the rendering spike after the core exists; use a dot-grid renderer until then.
4. Scaffold the monorepo with `core`, the daemon, the Claude Code adapter and
   the load generator, with CI on three OSes.

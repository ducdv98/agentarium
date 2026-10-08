# Prior art

Research date: 2026-10-08. Source: search results and the project's GitHub
README. Counts and roadmap items change; re-check before acting on them.

## Pixel Agents (closest existing project)

Repo: https://github.com/pablodelucca/pixel-agents (MIT). Several forks and
look-alike repos share the name (`martinmunozhr/pixel-agents`,
`pixel-agents-hq/pixel-agents`, `MichaelMa907/pixel-agents-codex`); the one
above is the one linked from the marketplace listing.

| Aspect | What it does |
|---|---|
| Concept | Each Claude Code session is a pixel-art character in a virtual office; sub-agents and Claude teammates appear as separate characters |
| Delivery | VS Code extension, plus standalone `npx pixel-agents` that serves the office in a browser |
| UI stack | React 19, Vite, Canvas 2D (rendering, pathfinding, character state machines) |
| Server stack | Fastify; esbuild bundles; Vitest, Node test runner, Playwright |
| Event source | Hooks by default (`SessionStart`, `PreToolUse`, `PermissionRequest`, `Stop`, ...) forwarded to local servers; fallback heuristic scanning Claude JSONL transcripts in `~/.claude/projects/`; transcripts also read in hooks mode for extra detail |
| Architecture | `core/` (contracts, no side effects), `server/`, `adapters/vscode/`, `webview-ui/`; provider output normalized into a shared `AgentEvent` model; a typed `HookProvider` interface to add a provider |
| Providers | Claude Code only implemented. Codex, Gemini, Cursor "on the roadmap" |
| Security | Binds `127.0.0.1` by default; URL carries a session token; hook install refused without it; warns that `0.0.0.0` exposes the UI to the network |
| Platforms | Windows, Linux, macOS; Node 20+ or VS Code 1.105+ |
| Traction | About 9.6k stars, 1.6k forks, 33 open issues (at research time) |
| Roadmap | (1) any agent in any environment; (2) game features: rate-limit health bars, scores, interactive furniture, per-project offices; (3) orchestration: orchestrator characters, team formation, handoffs, task boards |
| Art | Character designs credited to a third-party itch.io pack (JIK-A-4 Metro City); asset terms not stated on the README, so check the source |

## What this means for Agentarium

Pixel Agents already validates the idea, the hook-first approach with
transcript fallback, a shared normalized `AgentEvent` model, and the
local-server-plus-token security model. Several choices in these notes
independently match it (React + Vite, hooks first, `core` with no side effects,
127.0.0.1 binding).

Where the current Agentarium plan differs:

| Area | Pixel Agents | Agentarium plan |
|---|---|---|
| Camera / art | Top-down pixel art, Canvas 2D | Hand-drawn isometric 2D first, 3D later |
| Scene | One office | Swappable themes (office, farm, construction site) with a neutral core vocabulary ([themes.md](themes.md)) |
| Structure | Sub-agents and teammates | Relationship graph with observed, inferred, declared edges; topologies beyond a tree ([topologies.md](topologies.md)) |
| Scope | Per-project office (roadmap item) | One global daemon, one room per repo, cross-project overview ([architecture.md](architecture.md)) |
| Providers | Claude Code, others on roadmap | Multi-provider from the schema up (Claude Code, Codex, Gemini CLI, Cursor, OTel, proxy) |
| Delivery | VS Code extension and npx CLI | Global npm CLI plus browser UI |

## Decision to make

This is a strategic choice, not a technical one, and it should be made before
building:

1. **Build independently.** Keep the differentiators above. Expect overlap on
   the Claude Code adapter and the basic loop; study Pixel Agents' hook
   handling and transcript fallback before writing ours.
2. **Contribute upstream.** Its roadmap already names agent-agnostic support,
   per-project offices and orchestration. Themes, isometric art and 3D are
   unlikely to fit its pixel-art, Canvas 2D direction.
3. **Fork.** Fastest start; inherits its architecture and asset constraints.

For a hobby project the useful question is which parts are the point: if it is
the theme system, isometric art and 3D, those are what no existing project
covers, so option 1 is justified. If the point is simply to see agents in a
room, use Pixel Agents.

## Things to study in Pixel Agents before building

- How it installs, scopes and removes hooks safely (token-gated install).
- Its transcript-scanning heuristics and where hooks lack detail.
- How it models sub-agents and Agent Teams as characters.
- Its pathfinding and character state machine, which would be reimplemented on
  an isometric grid.
- Its test setup (Playwright and Allure) for visual regression.
- Its issue tracker, for real-world failure modes (Windows paths, multiple
  sessions, hook conflicts).

## Not yet researched

- Other projects in the space beyond Pixel Agents (search covered one query).
- Pixel Agents' license terms for bundled assets, and the license of the
  third-party character pack it credits.

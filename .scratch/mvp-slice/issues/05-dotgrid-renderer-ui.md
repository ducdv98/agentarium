# Dot-grid renderer and UI shell

Status: resolved
Type: task
Blocked by: 03

Renderer package behind the Renderer interface (mount, applyState, setTheme, resize, dispose), no React. React/Vite shell with roster panel and needs-input highlighting. Dot-grid theme resolved only through a theme manifest.

Acceptance: every state and action category resolves to something or falls back; no theme words in core.

## Comments

## Answer

- `packages/renderer`: `Renderer` interface (mount, applyState, setTheme, resize, dispose), data-only `Theme` manifest with `resolveAgent` (falls back for any missing state/category) and `validateTheme`, pure `layoutWorld`, canvas dot-grid renderer, `dot-grid` theme. Tests cover every state x category (plus null) resolving, fallback with an empty theme, and a scan that core/adapters/server sources contain no scene words.
- `packages/ui-web`: React/Vite shell (roster in triage order with needs-input highlighting, connection status, canvas stage). Pure `buildRoster` and `connect` (resync on gap, reconnect backoff) are unit-tested. Open `http://127.0.0.1:<port>/?token=<token>` (printed by `agentarium start`); for `vite dev` add `&daemon=127.0.0.1:<port>` and start the daemon with `allowedOrigins`.
- Server gained `staticDir` and `allowedOrigins`; the CLI daemon serves `packages/ui-web/dist` when built.
- Verified: build succeeds; real daemon + hook payloads yield the expected snapshot over WebSocket. The canvas and React roster were NOT viewed in a browser (the Chrome extension did not respond).

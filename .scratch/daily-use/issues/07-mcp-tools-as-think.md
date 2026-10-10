# MCP and unknown tools map to `think`

Status: resolved
Type: task
Blocked by: none

The Claude Code adapter maps any tool it does not recognise, including all MCP tools, to the `think` Action category. An agent busy with MCP calls looks like it is thinking. Options include mapping by MCP tool name patterns to existing categories, without adding categories (ADR 0004). Promote only if `usage-log.md` shows this misleading the user.

## Comments

- 2026-10-10: Promoted by the maintainer without a usage-log entry, so the usage-log gate was overridden on purpose. Implemented: MCP tools (`mcp__<server>__<tool>`) are now classified by the verb in their name (read, get, list, view, show -> read; search, find, query, grep, lookup -> search; write, create, update, edit, delete, remove, set, add, save, post, put, send, move, rename -> write; navigate, fetch, browse, request, http, download, upload -> network). Any other MCP tool defaults to `exec`, not `think`. Non-MCP unknown tools still map to `think`. No new action category (ADR 0004). Seam: `categoryForTool` in `packages/adapters/src/claude-code.ts`, tested in `packages/adapters/test/claude-code.test.ts`. Full suite and typecheck pass.

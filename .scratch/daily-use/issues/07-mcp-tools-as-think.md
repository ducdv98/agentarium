# MCP and unknown tools map to `think`

Status: needs-triage
Type: task
Blocked by: none

The Claude Code adapter maps any tool it does not recognise, including all MCP tools, to the `think` Action category. An agent busy with MCP calls looks like it is thinking. Options include mapping by MCP tool name patterns to existing categories, without adding categories (ADR 0004). Promote only if `usage-log.md` shows this misleading the user.

## Comments

# Wizard: claim the npm org and link trusted publishing

Status: ready-for-human
Type: task
Blocked by: 04

Generate a wizard script (`/wizard`) that walks the maintainer through the npmjs.com steps an agent cannot do: create the `@agentarium` org, create the package or first publish, and add the GitHub repository and release workflow as a trusted publisher. Then push the first `v0.1.0` tag.

Acceptance: `@agentarium/cli@0.1.0` is on npm with provenance, and `npx @agentarium/cli init` works on a clean machine.

## Comments

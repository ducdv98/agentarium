# Tag-triggered release workflow

Status: ready-for-agent
Type: task
Blocked by: 01

GitHub Actions workflow on `v*` tags: run the full CI matrix (3 OSes × Node 22 and 24), build, check that the tag matches the package version, and publish `@agentarium/cli` through npm trusted publishing (OIDC) with provenance. No npm token secret.

Acceptance: the workflow is valid and a dry run (`npm publish --dry-run`) passes in CI. A real publish depends on ticket 05.

## Comments

- 2026-10-09 (from ticket 01): `packages/cli/package.json` keeps `@agentarium/server` and `@agentarium/ui-web` as `workspace:*` devDependencies (everything is bundled; there are no runtime dependencies). `npm pack`/`npm publish` ship those specs verbatim; `pnpm publish` rewrites them. Publish with pnpm, or strip devDependencies before publishing.

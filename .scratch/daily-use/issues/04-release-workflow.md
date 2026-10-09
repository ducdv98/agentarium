# Tag-triggered release workflow

Status: resolved
Type: task
Blocked by: 01

GitHub Actions workflow on `v*` tags: run the full CI matrix (3 OSes × Node 22 and 24), build, check that the tag matches the package version, and publish `@agentarium/cli` through npm trusted publishing (OIDC) with provenance. No npm token secret.

Acceptance: the workflow is valid and a dry run (`npm publish --dry-run`) passes in CI. A real publish depends on ticket 05.

## Comments

- 2026-10-09 (from ticket 01): `packages/cli/package.json` keeps `@agentarium/server` and `@agentarium/ui-web` as `workspace:*` devDependencies (everything is bundled; there are no runtime dependencies). `npm pack`/`npm publish` ship those specs verbatim; `pnpm publish` rewrites them. Publish with pnpm, or strip devDependencies before publishing.
- 2026-10-09: `ci.yml` gains `workflow_call` so `release.yml` reuses the 3 OS x Node 22/24 matrix without duplicating it. `release.yml` runs on `v*` tags: CI, then on Node 24 (npm 11.x, which supports trusted publishing) a build, a guard that `GITHUB_REF_NAME` equals `v` + the `packages/cli` version, `npm publish --dry-run --provenance` and `npm publish --provenance` from `packages/cli`, with `id-token: write` and no token secret. Local checks: both YAML files parse, `pnpm typecheck`, `pnpm build`, the full test suite, and `npm publish --dry-run` (8 files, 135.1 kB, devDependencies with `workspace:*` do not block it). Not verified here: the GitHub Actions run itself, and the OIDC publish, which needs ticket 05 to register this workflow as the trusted publisher first. Resolved.

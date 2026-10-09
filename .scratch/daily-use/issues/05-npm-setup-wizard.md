# Wizard: claim the npm org and link trusted publishing

Status: resolved
Type: task
Blocked by: 04

Generate a wizard script (`/wizard`) that walks the maintainer through the npmjs.com steps an agent cannot do: create the `@agentarium` org, create the package or first publish, and add the GitHub repository and release workflow as a trusted publisher. Then push the first `v0.1.0` tag.

Acceptance: `@agentarium/cli@0.1.0` is on npm with provenance, and `npx @agentarium/cli init` works on a clean machine.

## Comments
- 2026-10-09: Wizard built at `scripts/npm-setup-wizard.sh` (from `/wizard`'s template; library above the marker unchanged). Seven stages: preflight, npm login and 2FA, create the `@agentarium` org, publish a `0.0.0` placeholder to reserve `@agentarium/cli`, link the trusted publisher (GitHub Actions, `ducdv98/agentarium`, `release.yml`, no environment), push `main`, then push `v0.1.0`. No secrets are captured or set, since trusted publishing needs none.
- Decision (asked of the maintainer): npm will not link a trusted publisher to a package that does not exist, and a local publish has no provenance, so the placeholder reserves the name first. Then CI publishes `0.1.0` with provenance, which keeps the acceptance criterion. Source for the bootstrap constraint is secondary (not npm's docs); verify on docs.npmjs.com when running it.
- Status stays `ready-for-human`: the acceptance needs a maintainer to run the wizard on npmjs.com and GitHub. The wizard is not run end to end here, as it opens browsers and waits for input. `bash -n` passes; `shellcheck` is not installed here.
- 2026-10-09: Done by the maintainer with help. `@agentarium` org created; `@agentarium/cli@0.0.0` placeholder published by hand (2FA); trusted publisher linked to `ducdv98/agentarium` / `release.yml`. First CI publish failed twice: the trusted publisher was not yet active, then provenance needed `repository` in `packages/cli/package.json`. Fixed in `03aa877`; `v0.1.0` re-pointed there. The Release run then succeeded. `npm view @agentarium/cli` shows `latest: 0.1.0` with a SLSA provenance attestation, and `npx @agentarium/cli@0.1.0 init` in a clean temp config prints the daemon-not-running warning. Open: npm also lists a `0.0.0-stage` version whose origin is not known; check the package's Versions page on npmjs.com. Resolved.

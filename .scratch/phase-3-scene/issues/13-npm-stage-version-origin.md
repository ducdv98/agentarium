# 13: Trace npm's `0.0.0-stage` version

**What to build:** npm lists a `0.0.0-stage` version of `@agentarium/cli` that nobody remembers publishing (daily-use 05). Check the package's Versions page and its provenance on npmjs.com, find where it came from, and deprecate or document it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] Its origin is recorded under `## Answer`
- [ ] Deprecated with a message if it shouldn't be installed

## Answer

`0.0.0-stage` is npm's own placeholder. It is created when someone stages a publish for a package that does not exist yet. Nobody published it as a release.

- npm's staged publishing docs say: "npm publishes a placeholder version of the package with the version `0.0.0-stage`". The placeholder is public. The staged version itself stays hidden until a maintainer approves it with 2FA ([docs.npmjs.com/staged-publishing](https://docs.npmjs.com/staged-publishing)). Creating a new package with `npm stage publish` shipped on 2026-10-02, a week before our setup ([changelog](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages)).
- Registry facts (`npm view @agentarium/cli time` and `@0.0.0-stage`, 2026-10-11):
  - `0.0.0-stage` was published 2026-10-09T16:37:27Z by `touching-grass` (the maintainer's account, not CI). It created the package.
  - The hand-published `0.0.0` placeholder came about two minutes later, at 16:39:35Z.
  - The CI release `0.1.0` came at 17:41:29Z, from `GitHub Actions <npm-oidc-no-reply@github.com>`. Only `0.1.0` has a SLSA provenance attestation. The stub has none (its attestations URL returns 404).
- The tarball has two files. One is a `package.json` with `"stub": true` and the description "Temporary package placeholder for staged publishing". The other is a README: "An operational version to replace this has been submitted for review and is awaiting a staged release." There is no `bin` and no code.
- What probably happened (not verified): during daily-use 05 stage 4, the first publish attempt from the maintainer's machine went through staged publishing, so npm created the stub. Then `npm publish --access public` from `scripts/npm-setup-wizard.sh` published `0.0.0`. npm 11.16 now warns that tokens which bypass 2FA are restricted from direct publishing. Checking this needs a logged-in `npm stage list @agentarium/cli`, which also shows whether a staged version is still waiting. This session's npm token is invalid (E401).
- Should not be installed: `npm i @agentarium/cli@0.0.0-stage` gets a stub with no CLI. Deprecate it. This needs the maintainer, logged in with 2FA:

      npm login
      npm deprecate @agentarium/cli@0.0.0-stage "npm staged-publishing placeholder, not a release. Install @agentarium/cli@latest."
      npm stage list @agentarium/cli   # reject any leftover staged version: npm stage reject <id>

  The `0.0.0` name-reservation placeholder can be deprecated the same way. npm's unpublish window for a version is 72 hours, so it closes around 2026-10-12T16:37Z for the stub. Deprecating keeps the version list stable, so prefer that.

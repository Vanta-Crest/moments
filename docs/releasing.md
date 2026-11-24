# Releasing

Moments is published to npm as `@vanta-crest/moments` under Apache-2.0. Releases
0.3.x are also published to GitHub Packages, so the move to npm can be undone;
drop that step after 0.3.

1. On `main`, run `npm version <patch|minor|major>`. The `version` script keeps
   `PACKAGE_VERSION` (the runner ↔ Director/panel protocol version) equal to
   `package.json`; `src/version.test.ts` fails if they ever drift.
2. `git push --follow-tags`. The `Publish` workflow runs on the `v*` tag: it checks
   the tag equals the package version, builds, tests, runs the CLI proof, installs
   the packed tarball into the task-app example, runs the browser proof, uploads
   the tarball and proof as an artifact, then publishes that exact tarball to npm
   (repository secret `NPM_TOKEN`, an automation token for the `vanta-crest` npm
   organisation) and to GitHub Packages.
3. Consumers bump the dependency in a separate, verified change.

A failed proof publishes nothing. Never publish from a laptop.

## Consuming

`npm install --save-dev @vanta-crest/moments @playwright/test`. No registry setup
or token is needed. Consumers of 0.2 and earlier on GitHub Packages remove the
`@vanta-crest:registry=https://npm.pkg.github.com` line from their `.npmrc`.

# Releasing

This page is for maintainers: how a version of `@vanta-crest/moments` is published.

Moments is published to npm under Apache-2.0, with provenance. Releases 0.3.x are also published to GitHub Packages, so the move to npm can be undone; drop that step after 0.3.

1. Update [the changelog](../CHANGELOG.md): give the unreleased section its version and date.
2. On `main`, run `npm version <patch|minor|major>` (or `npm version 0.3.0-rc.1` for a release candidate). The `version` script keeps `PACKAGE_VERSION`, the protocol version shared by the runner, panel and Director, equal to `package.json`; `src/version.test.ts` fails if they drift.
3. `git push --follow-tags`. The `Publish` workflow runs on the `v*` tag. It checks that the tag equals the package version, builds, tests, runs the CLI proof, installs the packed tarball into the task-app example, runs the browser proof, and uploads the tarball and proof as an artifact. It then publishes that exact tarball to npm with provenance, using the repository secret `NPM_TOKEN` (an automation token for the `vanta-crest` npm organisation), and to GitHub Packages.
4. Consumers upgrade in a separate, verified change.

A failed proof publishes nothing. Never publish from a laptop.

A version with a prerelease part (`0.3.0-rc.1`) is published under the `next` dist-tag; any other under `latest`. People test a candidate with `npm install -D @vanta-crest/moments@next`.

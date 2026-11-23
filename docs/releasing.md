# Releasing

Moments is published privately to GitHub Packages as `@vanta-crest/moments`.

1. On `main`, run `npm version <patch|minor|major>`. The `version` script keeps
   `PACKAGE_VERSION` (the runner ↔ Director/panel protocol version) equal to
   `package.json`; `src/version.test.ts` fails if they ever drift.
2. `git push --follow-tags`. The `Publish` workflow runs on the `v*` tag: it checks
   the tag equals the package version, builds, tests, runs the CLI proof, installs
   the packed tarball into the task-app example, runs the browser proof, uploads
   the tarball and proof as an artifact, then publishes that exact tarball.
3. Consumers bump the dependency in a separate, verified change.

A failed proof publishes nothing. Never publish from a laptop.

## Consuming

Add to the consuming repository's `.npmrc` (committed; it holds no secret):

```ini
@vanta-crest:registry=https://npm.pkg.github.com
```

Developers authenticate once with a token that has `read:packages`, e.g.
`npm login --scope=@vanta-crest --auth-type=legacy --registry=https://npm.pkg.github.com`
or `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` in their user `~/.npmrc`.
CI uses a token with `read:packages` access to `Vanta-Crest/moments`.
